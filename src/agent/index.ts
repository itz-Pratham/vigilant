// src/agent/index.ts
// Agent session management — Phase 3 full implementation.

import type { DetectedIssue, IssueSession } from './types.js';
import type { ExternalToolFinding }         from '../watcher/types.js';
import type { DomainPack }                  from './domain-context.js';
import type { VigilantConfig }              from '../config/types.js';
import { info, warn, error }               from '../lib/logger.js';
import {
  createSession,
  getSession,
  saveSession,
  getNextRunNumber,
} from '../db/queries/sessions.js';
import { SESSION_ID_PREFIX, STAGE } from '../lib/constants.js';
import { runAgentLoop }    from './loop.js';
import { generatePlan }    from './plan-generator.js';
import { findPackForIssueType } from './domain-context.js';

// ── Session ID builder ────────────────────────────────────────────────────────

function buildSessionId(
  issueType: string,
  owner:     string,
  name:      string,
  run:       number,
): string {
  const pad = String(run).padStart(3, '0');
  return `${SESSION_ID_PREFIX}_${issueType}_${owner}_${name}_${pad}`;
}

// ── Start a new session ───────────────────────────────────────────────────────

/**
 * Start an investigation session for a detected issue.
 * Creates a session record, runs the agentic investigation loop,
 * then generates a structured fix plan.
 * Returns null on non-fatal skip conditions (confidence too low).
 */
export async function startAgentSession(
  issue:        DetectedIssue,
  activePacks:  DomainPack[],
  config:       VigilantConfig,
  toolFindings: ExternalToolFinding[] = [],
): Promise<IssueSession | null> {
  // Resolve domain pack
  const pack = activePacks.find(p => p.id === issue.domain)
    ?? findPackForIssueType(issue.issueType)
    ?? activePacks[0];

  if (!pack) {
    warn(`No domain pack found for ${issue.issueType} — skipping`, 'agent');
    return null;
  }

  const runNumber = getNextRunNumber(issue.repoOwner, issue.repoName, issue.issueType, issue.sourceRef);
  const sessionId = buildSessionId(issue.issueType, issue.repoOwner, issue.repoName, runNumber);

  // Build initial evidence from both scanner and external tool findings
  const allEvidence = [
    ...issue.evidence,
    ...toolFindings.map(f => `[${f.tool}] ${f.comment}`),
  ];

  const now = new Date().toISOString();

  const session: IssueSession = {
    sessionId,
    repoOwner:       issue.repoOwner,
    repoName:        issue.repoName,
    domain:          issue.domain,
    issueType:       issue.issueType,
    stage:           STAGE.INVESTIGATING,
    severity:        issue.severity,
    confidence:      issue.confidence,
    sourceRef:       issue.sourceRef,
    evidence:        allEvidence,
    iterationCount:  0,
    goalProgress:    0,
    keyFindings:     [],
    dataCollected:   {},
    plan:            null,
    branchName:      null,
    prNumber:        null,
    prUrl:           null,
    prHeadSha:       null,
    ciStatus:        null,
    executorStep:    null,
    selfReviewCount: 0,
    blockerReason:   null,
    stallCount:      0,
    runNumber,
    createdAt:       now,
    updatedAt:       now,
  };

  createSession(session);
  info(`Created session ${sessionId} for ${issue.issueType}`, 'agent');

  try {
    await runAgentLoop(session, pack, config);
  } catch (err) {
    error(`Agent loop failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`, 'agent');
    // Session is already marked blocked by runAgentLoop on unrecoverable errors
    return session;
  }

  // If investigation succeeded, generate the plan
  if (session.stage === STAGE.INVESTIGATING && session.goalProgress >= 0.7) {
    try {
      await generatePlan(session, pack, config);
    } catch (err) {
      warn(`Plan generation failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`, 'agent');
      session.stage         = STAGE.BLOCKED;
      session.blockerReason = `Plan generation failed: ${err instanceof Error ? err.message : String(err)}`;
      saveSession(session);
    }
  }

  return session;
}

// ── Resume an interrupted session ────────────────────────────────────────────

/**
 * Resume a session that was interrupted mid-investigation (stage = investigating).
 * Only `investigating` sessions are auto-resumed — other stages require their
 * own phase handlers (executor, self-reviewer, etc.).
 */
export async function resumeSession(sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session) {
    warn(`Cannot resume ${sessionId} — session not found`, 'agent');
    return;
  }

  if (session.stage !== STAGE.INVESTIGATING) {
    info(`Session ${sessionId} is in stage ${session.stage} — skipping auto-resume`, 'agent');
    return;
  }

  info(`Resuming interrupted session ${sessionId} at iteration ${session.iterationCount}`, 'agent');

  const { loadConfig } = await import('../config/index.js');
  const config         = loadConfig();
  const allPacks       = await import('./domain-context.js').then(m =>
    m.resolveActivePacks(config),
  );
  const pack = allPacks.find(p => p.id === session.domain)
    ?? findPackForIssueType(session.issueType)
    ?? allPacks[0];

  if (!pack) {
    warn(`Cannot resume ${sessionId} — no domain pack found`, 'agent');
    return;
  }

  try {
    await runAgentLoop(session, pack, config);
  } catch (err) {
    error(`Resumed loop failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`, 'agent');
    return;
  }

  if (session.stage === STAGE.INVESTIGATING && session.goalProgress >= 0.7) {
    try {
      await generatePlan(session, pack, config);
    } catch (err) {
      warn(`Plan generation failed on resume for ${sessionId}`, 'agent');
      session.stage         = STAGE.BLOCKED;
      session.blockerReason = `Plan generation failed: ${err instanceof Error ? err.message : String(err)}`;
      saveSession(session);
    }
  }
}

