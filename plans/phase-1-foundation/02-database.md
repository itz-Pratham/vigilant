# Phase 1 — Database Schema

**File:** `src/db/schema.sql`, `src/db/index.ts`, `src/db/queries/sessions.ts`, `src/db/queries/watcher.ts`, `src/db/queries/knowledge.ts`

## Objective

Define the complete SQLite schema for both databases (`state.db` and `knowledge.db`), the connection initialisation code, and all query functions. Every database interaction in the entire project goes through these query functions — no raw SQL outside this directory.

---

## Schema File (`src/db/schema.sql`)

This file contains both schemas. `src/db/index.ts` reads and executes this on startup using `db.exec()`.

```sql
-- ═══════════════════════════════════════════════════════════
-- STATE DATABASE (state.db)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agent_sessions (
  session_id         TEXT PRIMARY KEY,
  repo_owner         TEXT NOT NULL,
  repo_name          TEXT NOT NULL,
  domain             TEXT NOT NULL,
  issue_type         TEXT NOT NULL,
  stage              TEXT NOT NULL DEFAULT 'discovered',
  severity           TEXT NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  confidence         REAL NOT NULL DEFAULT 0.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  source_ref         TEXT NOT NULL,
  evidence           TEXT NOT NULL DEFAULT '[]',
  iteration_count    INTEGER NOT NULL DEFAULT 0,
  goal_progress      REAL NOT NULL DEFAULT 0.0 CHECK (goal_progress >= 0.0 AND goal_progress <= 1.0),
  key_findings       TEXT NOT NULL DEFAULT '[]',
  data_collected     TEXT NOT NULL DEFAULT '{}',
  plan               TEXT,
  branch_name        TEXT,
  pr_number          INTEGER,
  pr_url             TEXT,
  pr_head_sha        TEXT,
  ci_status          TEXT CHECK (ci_status IN ('pending','running','passed','failed') OR ci_status IS NULL),
  executor_step      TEXT CHECK (executor_step IN ('branch_created','files_written','pr_created') OR executor_step IS NULL),
  self_review_count  INTEGER NOT NULL DEFAULT 0,   -- incremented each self-review iteration (max 3)
  blocker_reason     TEXT,
  stall_count        INTEGER NOT NULL DEFAULT 0,
  run_number         INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_repo
  ON agent_sessions (repo_owner, repo_name);
CREATE INDEX IF NOT EXISTS idx_sessions_stage
  ON agent_sessions (stage);
CREATE INDEX IF NOT EXISTS idx_sessions_dedup
  ON agent_sessions (repo_owner, repo_name, issue_type, source_ref, stage);

CREATE TABLE IF NOT EXISTS watcher_state (
  repo_owner         TEXT NOT NULL,
  repo_name          TEXT NOT NULL,
  scanner_name       TEXT NOT NULL,
  last_etag          TEXT,
  last_checked_at    TEXT NOT NULL,
  PRIMARY KEY (repo_owner, repo_name, scanner_name)
);

CREATE TABLE IF NOT EXISTS learning_topics (
  id                 TEXT PRIMARY KEY,
  domain             TEXT NOT NULL,
  topic              TEXT NOT NULL,
  search_query       TEXT NOT NULL,
  last_researched_at TEXT,
  research_count     INTEGER NOT NULL DEFAULT 0
);

-- ═══════════════════════════════════════════════════════════
-- KNOWLEDGE DATABASE (knowledge.db)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id                 TEXT PRIMARY KEY,
  scope              TEXT NOT NULL,
  domain             TEXT NOT NULL,
  topic              TEXT NOT NULL,
  source_url         TEXT NOT NULL,
  source_type        TEXT NOT NULL DEFAULT 'web',  -- 'git_history'|'team_decisions'|'user_feedback'|'github_repo'|'web'|'codebase'
  title              TEXT NOT NULL,
  content            TEXT NOT NULL,
  key_points         TEXT NOT NULL DEFAULT '[]',
  confidence         REAL NOT NULL DEFAULT 1.0,
  learned_at         TEXT NOT NULL,
  created_at         TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_url
  ON knowledge_documents (source_url);
CREATE INDEX IF NOT EXISTS idx_knowledge_scope_domain
  ON knowledge_documents (scope, domain);
CREATE INDEX IF NOT EXISTS idx_knowledge_topic
  ON knowledge_documents (topic);
```

---

## Database Initialisation (`src/db/index.ts`)

```typescript
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';
import { STATE_DB_PATH, KNOWLEDGE_DB_PATH } from '@/lib/constants';

let _stateDb: Database.Database | null = null;
let _knowledgeDb: Database.Database | null = null;

/** Opens state.db and runs schema migrations. Call once on startup. */
export function getStateDb(): Database.Database {
  if (_stateDb) return _stateDb;
  _stateDb = new Database(STATE_DB_PATH);
  _stateDb.pragma('journal_mode = WAL');   // better concurrent read performance
  _stateDb.pragma('foreign_keys = ON');
  runMigrations(_stateDb, 'state');
  return _stateDb;
}

/** Opens knowledge.db and runs schema migrations. Call once on startup. */
export function getKnowledgeDb(): Database.Database {
  if (_knowledgeDb) return _knowledgeDb;
  _knowledgeDb = new Database(KNOWLEDGE_DB_PATH);
  _knowledgeDb.pragma('journal_mode = WAL');
  runMigrations(_knowledgeDb, 'knowledge');
  return _knowledgeDb;
}

function runMigrations(db: Database.Database, name: string): void {
  const schema = readFileSync(
    join(__dirname, 'schema.sql'), 'utf-8'
  );
  // Split by the database comment markers to run only the relevant section
  const section = name === 'state'
    ? schema.split('-- KNOWLEDGE DATABASE')[0]
    : schema.split('-- KNOWLEDGE DATABASE')[1];
  db.exec(section ?? schema);
}
```

---

## Session Queries (`src/db/queries/sessions.ts`)

Every query function is typed end-to-end. No `any`.

```typescript
import type { IssueSession } from '@/agent/types';
import { getStateDb } from '@/db/index';
import { DatabaseError } from '@/lib/errors';

/** Insert a new session row. Throws DatabaseError on failure. */
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

/** Load a session by ID. Returns null if not found. */
export function getSession(sessionId: string): IssueSession | null {
  const db = getStateDb();
  const row = db.prepare(
    'SELECT * FROM agent_sessions WHERE session_id = ?'
  ).get(sessionId) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

/** Save (upsert) a session. Updates updated_at automatically. */
export function saveSession(session: IssueSession): void {
  const db = getStateDb();
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

/** List all sessions for a repo, ordered by created_at DESC */
export function listSessions(
  repoOwner: string,
  repoName: string
): IssueSession[] {
  const db = getStateDb();
  const rows = db.prepare(`
    SELECT * FROM agent_sessions
    WHERE repo_owner = ? AND repo_name = ?
    ORDER BY created_at DESC
  `).all(repoOwner, repoName) as Record<string, unknown>[];
  return rows.map(rowToSession);
}

/** List all sessions in a specific stage (e.g. 'awaiting_approval') */
export function listSessionsByStage(stage: string): IssueSession[] {
  const db = getStateDb();
  const rows = db.prepare(
    'SELECT * FROM agent_sessions WHERE stage = ? ORDER BY created_at ASC'
  ).all(stage) as Record<string, unknown>[];
  return rows.map(rowToSession);
}

/**
 * Check if an active session already exists for this issue.
 * Used by the watcher for deduplication before creating a new session.
 */
export function activeSessionExists(
  repoOwner: string,
  repoName: string,
  issueType: string,
  sourceRef: string
): boolean {
  const db = getStateDb();
  const terminalStages = ['merged', 'skipped', 'closed'];
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM agent_sessions
    WHERE repo_owner = ? AND repo_name = ? AND issue_type = ? AND source_ref = ?
    AND stage NOT IN (${terminalStages.map(() => '?').join(',')})
  `).get(repoOwner, repoName, issueType, sourceRef, ...terminalStages) as { count: number };
  return result.count > 0;
}

/** Get the next run number for a given issueType + sourceRef combination */
export function getNextRunNumber(
  repoOwner: string,
  repoName: string,
  issueType: string,
  sourceRef: string
): number {
  const db = getStateDb();
  const result = db.prepare(`
    SELECT MAX(run_number) as maxRun FROM agent_sessions
    WHERE repo_owner = ? AND repo_name = ? AND issue_type = ? AND source_ref = ?
  `).get(repoOwner, repoName, issueType, sourceRef) as { maxRun: number | null };
  return (result.maxRun ?? 0) + 1;
}

// ── Serialisation helpers ──────────────────────────────────────────────

function sessionToRow(s: IssueSession): Record<string, unknown> {
  return {
    sessionId: s.sessionId, repoOwner: s.repoOwner, repoName: s.repoName,
    domain: s.domain, issueType: s.issueType, stage: s.stage,
    severity: s.severity, confidence: s.confidence, sourceRef: s.sourceRef,
    evidence: JSON.stringify(s.evidence),
    iterationCount: s.iterationCount, goalProgress: s.goalProgress,
    keyFindings: JSON.stringify(s.keyFindings),
    dataCollected: JSON.stringify(s.dataCollected),
    plan: s.plan ? JSON.stringify(s.plan) : null,
    branchName: s.branchName, prNumber: s.prNumber, prUrl: s.prUrl,
    prHeadSha: s.prHeadSha, ciStatus: s.ciStatus,
    executorStep: s.executorStep, selfReviewCount: s.selfReviewCount,
    blockerReason: s.blockerReason,
    stallCount: s.stallCount, runNumber: s.runNumber,
    createdAt: s.createdAt, updatedAt: s.updatedAt,
  };
}

function rowToSession(row: Record<string, unknown>): IssueSession {
  return {
    sessionId: row.session_id as string,
    repoOwner: row.repo_owner as string,
    repoName: row.repo_name as string,
    domain: row.domain as string,
    issueType: row.issue_type as string,
    stage: row.stage as IssueSession['stage'],
    severity: row.severity as IssueSession['severity'],
    confidence: row.confidence as number,
    sourceRef: row.source_ref as string,
    evidence: JSON.parse(row.evidence as string),
    iterationCount: row.iteration_count as number,
    goalProgress: row.goal_progress as number,
    keyFindings: JSON.parse(row.key_findings as string),
    dataCollected: JSON.parse(row.data_collected as string),
    plan: row.plan ? JSON.parse(row.plan as string) : null,
    branchName: row.branch_name as string | null,
    prNumber: row.pr_number as number | null,
    prUrl: row.pr_url as string | null,
    prHeadSha: row.pr_head_sha as string | null,
    ciStatus: row.ci_status as IssueSession['ciStatus'],
    executorStep: row.executor_step as IssueSession['executorStep'],
    selfReviewCount: (row.self_review_count as number) ?? 0,
    blockerReason: row.blocker_reason as string | null,
    stallCount: row.stall_count as number,
    runNumber: row.run_number as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
```
