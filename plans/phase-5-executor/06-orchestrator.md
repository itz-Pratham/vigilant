# Phase 5 — Executor Orchestrator

**File:** `src/executor/index.ts`

## Objective

`runExecutor()` is the single entry point for Phase 5. It executes all four steps in order (branch → write → PR → CI), saves step progress after each, and gracefully resumes from the last completed step on restart.

---

## Implementation

```typescript
// src/executor/index.ts
import { Octokit }          from '@octokit/rest';
import { NeuroLink }        from '@juspay/neurolink';
import { IssueSession }     from '../types.js';
import { ExecutorContext }  from './types.js';
import { resolveBaseSha, createBranch } from './branch-creator.js';
import { writeAllChanges }              from './code-writer.js';
import { createPR }                     from './pr-creator.js';
import { monitorCI }                    from './ci-monitor.js';
import { advanceStage, markBlocked, saveSession } from '../agent/state-manager.js';
import { getStateDb }                   from '../db/state.js';
import { ExecutorError }                from '../errors.js';

export async function runExecutor(
  session:   IssueSession,
  octokit:   Octokit,
  neurolink: NeuroLink,
): Promise<void> {
  const db   = getStateDb();
  const step = (session as any).executorStep as string ?? 'not_started';
  const { owner, repo } = session;
  const plan = session.plan!;

  let ctx: ExecutorContext;
  let defaultBranch: string;

  // ── Step 1: Create branch ─────────────────────────────────────────────────
  if (step === 'not_started') {
    try {
      const base = await resolveBaseSha(octokit, owner, repo);
      defaultBranch = base.defaultBranch;
      ctx = { owner, repo, branchName: plan.branchName, baseSha: base.sha };

      await createBranch(octokit, ctx);
      saveExecutorStep(db, session.sessionId, 'branch_created');
    } catch (err: any) {
      await markBlocked(db, session.sessionId, `Branch creation failed: ${err.message}`);
      return;
    }
  } else {
    // Restart: resolve base sha again (branch already exists)
    const base    = await resolveBaseSha(octokit, owner, repo);
    defaultBranch = base.defaultBranch;
    ctx = { owner, repo, branchName: plan.branchName, baseSha: base.sha };
  }

  // ── Step 2: Write file changes ────────────────────────────────────────────
  if (step === 'not_started' || step === 'branch_created') {
    const results = await writeAllChanges(octokit, neurolink, session, ctx!);
    const failures = results.filter(r => !r.success);

    if (failures.length > 0) {
      const paths = failures.map(f => f.path).join(', ');
      await markBlocked(db, session.sessionId, `File write failed for: ${paths}`);
      return;
    }

    saveExecutorStep(db, session.sessionId, 'files_written');
  }

  // ── Step 3: Create PR ─────────────────────────────────────────────────────
  let prNumber: number;
  let prUrl:    string;
  let prSha:    string;

  if (step === 'not_started' || step === 'branch_created' || step === 'files_written') {
    try {
      const pr = await createPR(octokit, session, ctx!, defaultBranch!);
      prNumber  = pr.prNumber;
      prUrl     = pr.prUrl;
      prSha     = pr.prSha;

      // Save PR info to session
      db.prepare(`UPDATE agent_sessions SET pr_number = ?, pr_url = ?, executor_step = 'pr_created' WHERE session_id = ?`)
        .run(prNumber, prUrl, session.sessionId);
    } catch (err: any) {
      await markBlocked(db, session.sessionId, `PR creation failed: ${err.message}`);
      return;
    }
  } else {
    // Restart from pr_created or ci_monitoring — load saved PR info
    const saved = db.prepare(`SELECT pr_number, pr_url FROM agent_sessions WHERE session_id = ?`)
      .get(session.sessionId) as { pr_number: number; pr_url: string };
    prNumber = saved.pr_number;
    prUrl    = saved.pr_url;
    prSha    = session.plan!.branchName; // sha loaded separately
    // Re-resolve PR head SHA
    const { data: prData } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
    prSha = prData.head.sha;
  }

  // ── Step 4: Monitor CI ────────────────────────────────────────────────────
  saveExecutorStep(db, session.sessionId, 'ci_monitoring');

  const ciResult = await monitorCI(octokit, owner, repo, prSha!);

  if (ciResult.status === 'success') {
    db.prepare(`UPDATE agent_sessions SET ci_status = 'passed', stage = 'awaiting_merge' WHERE session_id = ?`)
      .run(session.sessionId);
  } else {
    await markBlocked(db, session.sessionId, `CI failed: ${ciResult.failedJob ?? 'unknown'}`);
  }
}

function saveExecutorStep(db: any, sessionId: string, step: string): void {
  db.prepare(`UPDATE agent_sessions SET executor_step = ? WHERE session_id = ?`).run(step, sessionId);
}
```

---

## Execution Flow Diagram

```
Agent produces Plan → stage: awaiting_self_review
     │
     ▼
Self-Reviewer runs (Phase 5, see 11-self-review-loop.md)
  → reads own planned diff
  → checks: regressions? missing imports? team patterns?
  → max 3 iterations [self_review_count saved to SQLite]
     │
  issues found                  clean
     │                           │
     ▼                           ▼
push corrections         stage: awaiting_approval
re-review                       │
                                 ▼
                          Gate 1 approved
                                 │
                                 ▼
resolveBaseSha()  → GET /repos/.../git/ref/heads/{default}
     │
     ▼
createBranch()    → POST /repos/.../git/refs
     │  [save: branch_created]
     ▼
writeAllChanges() → sequential PUT /repos/.../contents/{path} × N files
     │  [save: files_written]
     ▼
createPR()        → POST /repos/.../pulls
     │  [save: pr_created + pr_number + pr_url]
     │
     │  Tool Observer reads Snyk/CodeRabbit feedback on this PR (if tools present)
     ▼
monitorCI()       → poll every 60s for up to 30 min
     │
   success                  failure / timeout
     │                           │
     ▼                           ▼
stage=awaiting_merge     stage=blocked
ciStatus=passed          blockerReason="CI failed: {job}"
     │
     ▼
Gate 2 prompt (Phase 4)
```
