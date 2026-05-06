// src/executor/index.ts
// Executor orchestrator — runs branch creation, file writes, and PR creation
// for sessions in 'executing' stage; polls CI for sessions in 'pr_created' stage.
//
// Crash recovery: each step saves `executorStep` to SQLite before returning,
// so a restart skips already-completed steps.

import { info, warn, error as logError } from '../lib/logger.js';
import { saveSession }                   from '../db/queries/sessions.js';
import { listSessionsByStage }           from '../db/queries/sessions.js';
import { STAGE }                         from '../lib/constants.js';
import { ExecutorError }                 from '../lib/errors.js';
import { enqueueGate }                   from '../hitl/index.js';
import { resolveBaseSha, createBranch }  from './branch-creator.js';
import { writeAllChanges }               from './code-writer.js';
import { createPR }                      from './pr-creator.js';
import { checkCIStatus }                 from './ci-monitor.js';
import type { IssueSession }             from '../agent/types.js';
import type { ExecutorContext }          from './types.js';

/**
 * Runs executor steps 1–3 for a session in 'executing' stage:
 *   Step 1 — create branch (skipped if executorStep = 'branch_created' or later)
 *   Step 2 — write file changes (skipped if executorStep = 'files_written' or later)
 *   Step 3 — create PR, transition to 'pr_created'
 *
 * On any failure the session is marked `blocked` and the function returns.
 */
export async function runExecutor(session: IssueSession): Promise<void> {
  if (!session.plan) {
    warn(`Session ${session.sessionId} has no plan — cannot execute`, 'executor');
    session.stage         = STAGE.BLOCKED;
    session.blockerReason = 'Executor called with no plan';
    saveSession(session);
    return;
  }

  const { repoOwner: owner, repoName: repo } = session;
  const step = session.executorStep;     // null | 'branch_created' | 'files_written' | 'pr_created'
  let ctx: ExecutorContext;

  // ── Step 1: Create branch ──────────────────────────────────────────────────

  if (step === null) {
    try {
      const base = await resolveBaseSha(owner, repo);
      ctx = {
        owner,
        repo,
        branchName:    session.plan.branchName,
        baseSha:       base.sha,
        defaultBranch: base.defaultBranch,
      };

      await createBranch(ctx, session.sessionId);

      session.executorStep = 'branch_created';
      session.branchName   = ctx.branchName;
      saveSession(session);
      info(`[${session.sessionId}] Step 1 complete — branch ${ctx.branchName}`, 'executor');
    } catch (err: unknown) {
      session.stage         = STAGE.BLOCKED;
      session.blockerReason = err instanceof ExecutorError
        ? err.message
        : `Branch step failed: ${err instanceof Error ? err.message : String(err)}`;
      saveSession(session);
      return;
    }
  } else {
    // Resuming — resolve base SHA again (branch already exists, we just need the SHA + default branch)
    const base = await resolveBaseSha(owner, repo);
    ctx = {
      owner,
      repo,
      branchName:    session.plan.branchName,
      baseSha:       base.sha,
      defaultBranch: base.defaultBranch,
    };
  }

  // ── Step 2: Write file changes ─────────────────────────────────────────────

  if (step === null || step === 'branch_created') {
    const results  = await writeAllChanges(session, ctx);
    const failures = results.filter(r => !r.success);

    if (failures.length > 0) {
      session.stage         = STAGE.BLOCKED;
      session.blockerReason = `File write failed: ${failures.map(f => `${f.path} (${f.error ?? 'unknown'})`).join('; ')}`;
      saveSession(session);
      return;
    }

    session.executorStep = 'files_written';
    saveSession(session);
    info(`[${session.sessionId}] Step 2 complete — ${results.length} file(s) written`, 'executor');
  }

  // ── Step 3: Create PR ──────────────────────────────────────────────────────

  if (step === null || step === 'branch_created' || step === 'files_written') {
    try {
      const { prNumber, prUrl, prHeadSha } = await createPR(session, ctx);

      session.executorStep = 'pr_created';
      session.prNumber     = prNumber;
      session.prUrl        = prUrl;
      session.prHeadSha    = prHeadSha;
      session.ciStatus     = 'pending';
      session.stage        = STAGE.PR_CREATED;
      saveSession(session);
      info(`[${session.sessionId}] Step 3 complete — PR #${prNumber} at ${prUrl}`, 'executor');
    } catch (err: unknown) {
      session.stage         = STAGE.BLOCKED;
      session.blockerReason = err instanceof ExecutorError
        ? err.message
        : `PR creation failed: ${err instanceof Error ? err.message : String(err)}`;
      saveSession(session);
    }
  }
}

/**
 * Polls CI once for a session in 'pr_created' stage.
 * Called once per daemon tick — a single HTTP request, never a blocking loop.
 *
 * Transitions:
 *   success → stage='awaiting_merge', ciStatus='passed', enqueueGate(2)
 *   failure → stage='blocked', ciStatus='failed'
 *   pending/running → update ciStatus, return (next tick will poll again)
 */
export async function pollCIOnce(session: IssueSession): Promise<void> {
  if (!session.prHeadSha) {
    warn(`[${session.sessionId}] in pr_created stage but has no prHeadSha`, 'executor');
    return;
  }

  const result = await checkCIStatus(session.repoOwner, session.repoName, session.prHeadSha);

  switch (result.status) {
    case 'pending':
      if (session.ciStatus !== 'pending') {
        session.ciStatus = 'pending';
        saveSession(session);
      }
      return;

    case 'running':
      if (session.ciStatus !== 'running') {
        session.ciStatus = 'running';
        saveSession(session);
      }
      return;

    case 'success':
      info(`[${session.sessionId}] CI passed — transitioning to awaiting_merge`, 'executor');
      session.ciStatus = 'passed';
      session.stage    = STAGE.AWAITING_MERGE;
      saveSession(session);
      enqueueGate(session.sessionId, 2);
      return;

    case 'failure':
      warn(`[${session.sessionId}] CI failed: ${result.failedJob ?? 'unknown job'}`, 'executor');
      session.ciStatus     = 'failed';
      session.stage        = STAGE.BLOCKED;
      session.blockerReason = `CI failed: ${result.failedJob ?? 'unknown job'}`;
      saveSession(session);
      return;
  }
}

/**
 * Dispatches executor work for all sessions currently in 'executing' or 'pr_created' stage.
 * Called once per daemon tick — all CI checks are single HTTP requests (no blocking loops).
 */
export async function dispatchExecutor(): Promise<void> {
  const executingSessions = listSessionsByStage(STAGE.EXECUTING);
  const prCreatedSessions = listSessionsByStage(STAGE.PR_CREATED);

  await Promise.allSettled([
    ...executingSessions.map(s =>
      runExecutor(s).catch(err =>
        logError(`[${s.sessionId}] Executor failed: ${err instanceof Error ? err.message : String(err)}`, 'executor'),
      ),
    ),
    ...prCreatedSessions.map(s =>
      pollCIOnce(s).catch(err =>
        logError(`[${s.sessionId}] CI poll failed: ${err instanceof Error ? err.message : String(err)}`, 'executor'),
      ),
    ),
  ]);
}
