// src/db/queries/sessions.ts

import type { IssueSession } from '../../agent/types.js';
import { getStateDb } from '../index.js';

// ── Public query API ──────────────────────────────────────────────────────────

export function createSession(session: IssueSession): void {
  const db = getStateDb();
  db.prepare(`
    INSERT INTO agent_sessions (
      session_id, repo_owner, repo_name, domain, issue_type, stage,
      severity, confidence, source_ref, evidence, iteration_count,
      goal_progress, key_findings, data_collected, plan, branch_name,
      pr_number, pr_url, pr_head_sha, ci_status, executor_step,
      self_review_count, blocker_reason, stall_count, run_number, created_at, updated_at
    ) VALUES (
      @sessionId, @repoOwner, @repoName, @domain, @issueType, @stage,
      @severity, @confidence, @sourceRef, @evidence, @iterationCount,
      @goalProgress, @keyFindings, @dataCollected, @plan, @branchName,
      @prNumber, @prUrl, @prHeadSha, @ciStatus, @executorStep,
      @selfReviewCount, @blockerReason, @stallCount, @runNumber, @createdAt, @updatedAt
    )
  `).run(sessionToRow(session));
}

export function getSession(sessionId: string): IssueSession | null {
  const db  = getStateDb();
  const row = db.prepare(
    'SELECT * FROM agent_sessions WHERE session_id = ?'
  ).get(sessionId) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

export function saveSession(session: IssueSession): void {
  const db  = getStateDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE agent_sessions SET
      stage = @stage, severity = @severity, confidence = @confidence,
      iteration_count = @iterationCount, goal_progress = @goalProgress,
      key_findings = @keyFindings, data_collected = @dataCollected,
      plan = @plan, branch_name = @branchName, pr_number = @prNumber,
      pr_url = @prUrl, pr_head_sha = @prHeadSha, ci_status = @ciStatus,
      executor_step = @executorStep, self_review_count = @selfReviewCount,
      blocker_reason = @blockerReason, stall_count = @stallCount,
      updated_at = @updatedAt
    WHERE session_id = @sessionId
  `).run({ ...sessionToRow(session), updatedAt: now });
}

export function listSessions(repoOwner: string, repoName: string): IssueSession[] {
  const db   = getStateDb();
  const rows = db.prepare(`
    SELECT * FROM agent_sessions
    WHERE repo_owner = ? AND repo_name = ?
    ORDER BY created_at DESC
  `).all(repoOwner, repoName) as Record<string, unknown>[];
  return rows.map(rowToSession);
}

export function listSessionsByStage(stage: string): IssueSession[] {
  const db   = getStateDb();
  const rows = db.prepare(
    'SELECT * FROM agent_sessions WHERE stage = ? ORDER BY created_at ASC'
  ).all(stage) as Record<string, unknown>[];
  return rows.map(rowToSession);
}

export function listAllSessions(): IssueSession[] {
  const db   = getStateDb();
  const rows = db.prepare(
    'SELECT * FROM agent_sessions ORDER BY created_at DESC'
  ).all() as Record<string, unknown>[];
  return rows.map(rowToSession);
}

export function activeSessionExists(
  repoOwner: string,
  repoName:  string,
  issueType: string,
  sourceRef: string,
): boolean {
  const db             = getStateDb();
  const terminalStages = ['merged', 'skipped', 'closed'];
  const placeholders   = terminalStages.map(() => '?').join(',');
  const result         = db.prepare(`
    SELECT COUNT(*) as count FROM agent_sessions
    WHERE repo_owner = ? AND repo_name = ? AND issue_type = ? AND source_ref = ?
    AND stage NOT IN (${placeholders})
  `).get(repoOwner, repoName, issueType, sourceRef, ...terminalStages) as { count: number };
  return result.count > 0;
}

export function getNextRunNumber(
  repoOwner: string,
  repoName:  string,
  issueType: string,
  sourceRef: string,
): number {
  const db     = getStateDb();
  const result = db.prepare(`
    SELECT MAX(run_number) as maxRun FROM agent_sessions
    WHERE repo_owner = ? AND repo_name = ? AND issue_type = ? AND source_ref = ?
  `).get(repoOwner, repoName, issueType, sourceRef) as { maxRun: number | null };
  return (result.maxRun ?? 0) + 1;
}

// ── Serialisation helpers ─────────────────────────────────────────────────────

function sessionToRow(s: IssueSession): Record<string, unknown> {
  return {
    sessionId:       s.sessionId,
    repoOwner:       s.repoOwner,
    repoName:        s.repoName,
    domain:          s.domain,
    issueType:       s.issueType,
    stage:           s.stage,
    severity:        s.severity,
    confidence:      s.confidence,
    sourceRef:       s.sourceRef,
    evidence:        JSON.stringify(s.evidence),
    iterationCount:  s.iterationCount,
    goalProgress:    s.goalProgress,
    keyFindings:     JSON.stringify(s.keyFindings),
    dataCollected:   JSON.stringify(s.dataCollected),
    plan:            s.plan ? JSON.stringify(s.plan) : null,
    branchName:      s.branchName,
    prNumber:        s.prNumber,
    prUrl:           s.prUrl,
    prHeadSha:       s.prHeadSha,
    ciStatus:        s.ciStatus,
    executorStep:    s.executorStep,
    selfReviewCount: s.selfReviewCount,
    blockerReason:   s.blockerReason,
    stallCount:      s.stallCount,
    runNumber:       s.runNumber,
    createdAt:       s.createdAt,
    updatedAt:       s.updatedAt,
  };
}

function rowToSession(row: Record<string, unknown>): IssueSession {
  return {
    sessionId:       row['session_id']       as string,
    repoOwner:       row['repo_owner']        as string,
    repoName:        row['repo_name']         as string,
    domain:          row['domain']            as string,
    issueType:       row['issue_type']        as string,
    stage:           row['stage']             as IssueSession['stage'],
    severity:        row['severity']          as IssueSession['severity'],
    confidence:      row['confidence']        as number,
    sourceRef:       row['source_ref']        as string,
    evidence:        JSON.parse(row['evidence']      as string) as string[],
    iterationCount:  row['iteration_count']   as number,
    goalProgress:    row['goal_progress']     as number,
    keyFindings:     JSON.parse(row['key_findings']  as string) as string[],
    dataCollected:   JSON.parse(row['data_collected'] as string) as Record<string, unknown>,
    plan:            row['plan'] ? JSON.parse(row['plan'] as string) as Record<string, unknown> : null,
    branchName:      row['branch_name']       as string | null,
    prNumber:        row['pr_number']         as number | null,
    prUrl:           row['pr_url']            as string | null,
    prHeadSha:       row['pr_head_sha']       as string | null,
    ciStatus:        row['ci_status']         as IssueSession['ciStatus'],
    executorStep:    row['executor_step']     as IssueSession['executorStep'],
    selfReviewCount: (row['self_review_count'] as number) ?? 0,
    blockerReason:   row['blocker_reason']    as string | null,
    stallCount:      row['stall_count']       as number,
    runNumber:       row['run_number']        as number,
    createdAt:       row['created_at']        as string,
    updatedAt:       row['updated_at']        as string,
  };
}
