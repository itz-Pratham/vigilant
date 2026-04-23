# Phase 3 — Agent State Manager

**File:** `src/agent/stateManager.ts`

## Objective

Translates `IssueSession` to/from the `agent_sessions` SQLite table. Called after every agentic loop iteration so that a restart resumes exactly where it stopped.

---

## Implementation

```typescript
import { getStateDb } from '@/db';
import { VigilantError } from '@/lib/errors';
import type { IssueSession, IssueStage } from './types';

type SessionRow = {
  session_id: string; repo_owner: string; repo_name: string;
  domain: string; issue_type: string; stage: string; severity: string;
  confidence: number; source_ref: string; iteration_count: number;
  goal_progress: number; key_findings: string | null;
  data_collected: string | null; plan: string | null;
  branch_name: string | null; pr_number: number | null; pr_url: string | null;
  ci_status: string | null; blocker_reason: string | null;
  self_review_count: number;
  created_at: string; updated_at: string;
};

function rowToSession(row: SessionRow): IssueSession {
  return {
    sessionId:      row.session_id,
    repoOwner:      row.repo_owner,
    repoName:       row.repo_name,
    domain:         row.domain,
    issueType:      row.issue_type as IssueSession['issueType'],
    stage:          row.stage as IssueStage,
    severity:       row.severity as IssueSession['severity'],
    confidence:     row.confidence,
    sourceRef:      row.source_ref,
    iterationCount: row.iteration_count,
    goalProgress:   row.goal_progress,
    keyFindings:    row.key_findings ? JSON.parse(row.key_findings) : [],
    dataCollected:  row.data_collected ? JSON.parse(row.data_collected) : {},
    plan:           row.plan ? JSON.parse(row.plan) : null,
    branchName:     row.branch_name  ?? undefined,
    prNumber:       row.pr_number    ?? undefined,
    prUrl:          row.pr_url       ?? undefined,
    ciStatus:       row.ci_status    ?? undefined,
    blockerReason:  row.blocker_reason ?? undefined,
    selfReviewCount: row.self_review_count ?? 0,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
  };
}

export function loadSession(sessionId: string): IssueSession | null {
  const row = getStateDb()
    .prepare('SELECT * FROM agent_sessions WHERE session_id = ?')
    .get(sessionId) as SessionRow | undefined;
  return row ? rowToSession(row) : null;
}

export function saveSession(session: IssueSession): void {
  const now = new Date().toISOString();
  getStateDb().prepare(`
    INSERT OR REPLACE INTO agent_sessions (
      session_id, repo_owner, repo_name, domain, issue_type,
      stage, severity, confidence, source_ref, iteration_count,
      goal_progress, key_findings, data_collected, plan,
      branch_name, pr_number, pr_url, ci_status, blocker_reason,
      self_review_count,
      created_at, updated_at
    ) VALUES (
      @session_id, @repo_owner, @repo_name, @domain, @issue_type,
      @stage, @severity, @confidence, @source_ref, @iteration_count,
      @goal_progress, @key_findings, @data_collected, @plan,
      @branch_name, @pr_number, @pr_url, @ci_status, @blocker_reason,
      @self_review_count,
      @created_at, @updated_at
    )
  `).run({
    session_id:        session.sessionId,
    repo_owner:        session.repoOwner,
    repo_name:         session.repoName,
    domain:            session.domain,
    issue_type:        session.issueType,
    stage:             session.stage,
    severity:          session.severity,
    confidence:        session.confidence,
    source_ref:        session.sourceRef,
    iteration_count:   session.iterationCount,
    goal_progress:     session.goalProgress,
    key_findings:      session.keyFindings.length > 0 ? JSON.stringify(session.keyFindings) : null,
    data_collected:    Object.keys(session.dataCollected).length > 0 ? JSON.stringify(session.dataCollected) : null,
    plan:              session.plan ? JSON.stringify(session.plan) : null,
    branch_name:       session.branchName  ?? null,
    pr_number:         session.prNumber    ?? null,
    pr_url:            session.prUrl       ?? null,
    ci_status:         session.ciStatus    ?? null,
    blocker_reason:    session.blockerReason ?? null,
    self_review_count: session.selfReviewCount ?? 0,
    created_at:        session.createdAt,
    updated_at:        now,
  });
  session.updatedAt = now;
}

export function advanceStage(session: IssueSession, newStage: IssueStage): void {
  if (newStage === 'blocked') {
    session.dataCollected = { ...session.dataCollected, previousStage: session.stage };
  }
  session.stage = newStage;
  saveSession(session);
}

export function markBlocked(session: IssueSession, reason: string): void {
  session.blockerReason = reason;
  advanceStage(session, 'blocked');
}

export function resumeFromBlocked(session: IssueSession): void {
  if (session.stage !== 'blocked') throw new VigilantError(`Session ${session.sessionId} is not blocked`);
  const prev = (session.dataCollected.previousStage as IssueStage | undefined) ?? 'investigating';
  const { previousStage: _, ...rest } = session.dataCollected;
  session.dataCollected = rest;
  session.blockerReason = undefined;
  advanceStage(session, prev);
}

/** All non-terminal sessions for a repo. Used by watcher dedup. */
export function listActiveSessions(repoOwner: string, repoName: string): IssueSession[] {
  const rows = getStateDb().prepare(`
    SELECT * FROM agent_sessions
    WHERE repo_owner = ? AND repo_name = ?
      AND stage NOT IN ('merged', 'skipped', 'closed')
  `).all(repoOwner, repoName) as SessionRow[];
  return rows.map(rowToSession);
}

/** Sessions interrupted mid-investigation (daemon restart). */
export function findInterruptedSessions(): IssueSession[] {
  const rows = getStateDb()
    .prepare(`SELECT * FROM agent_sessions WHERE stage = 'investigating'`)
    .all() as SessionRow[];
  return rows.map(rowToSession);
}

/** True if a non-terminal session already exists for this issue+ref combo. */
export function sessionExistsForIssue(
  repoOwner: string, repoName: string, issueType: string, sourceRef: string,
): boolean {
  return !!getStateDb().prepare(`
    SELECT 1 FROM agent_sessions
    WHERE repo_owner = ? AND repo_name = ? AND issue_type = ? AND source_ref = ?
      AND stage NOT IN ('merged', 'skipped', 'closed') LIMIT 1
  `).get(repoOwner, repoName, issueType, sourceRef);
}
```
