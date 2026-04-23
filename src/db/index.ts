// src/db/index.ts
// Opens both SQLite databases and runs schema migrations on first open.

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { VIGILANT_DIR, STATE_DB_PATH, KNOWLEDGE_DB_PATH } from '../lib/constants.js';

// ── Inline schemas ────────────────────────────────────────────────────────────

const STATE_SCHEMA = `
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
  self_review_count  INTEGER NOT NULL DEFAULT 0,
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
  repo_owner      TEXT NOT NULL,
  repo_name       TEXT NOT NULL,
  scanner_name    TEXT NOT NULL,
  last_etag       TEXT,
  last_checked_at TEXT NOT NULL,
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
`;

const KNOWLEDGE_SCHEMA = `
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id           TEXT PRIMARY KEY,
  scope        TEXT NOT NULL,
  domain       TEXT NOT NULL,
  topic        TEXT NOT NULL,
  source_url   TEXT NOT NULL,
  source_type  TEXT NOT NULL DEFAULT 'web',
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,
  key_points   TEXT NOT NULL DEFAULT '[]',
  confidence   REAL NOT NULL DEFAULT 1.0,
  learned_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_url
  ON knowledge_documents (source_url);
CREATE INDEX IF NOT EXISTS idx_knowledge_scope_domain
  ON knowledge_documents (scope, domain);
CREATE INDEX IF NOT EXISTS idx_knowledge_topic
  ON knowledge_documents (topic);
`;

// ── Singletons ────────────────────────────────────────────────────────────────

let _stateDb:     Database.Database | null = null;
let _knowledgeDb: Database.Database | null = null;

/** Opens state.db and runs migrations. Returns the same instance on subsequent calls. */
export function getStateDb(): Database.Database {
  if (_stateDb) return _stateDb;
  ensureDir();
  _stateDb = new Database(STATE_DB_PATH);
  _stateDb.pragma('journal_mode = WAL');
  _stateDb.pragma('foreign_keys = ON');
  _stateDb.exec(STATE_SCHEMA);
  return _stateDb;
}

/** Opens knowledge.db and runs migrations. Returns the same instance on subsequent calls. */
export function getKnowledgeDb(): Database.Database {
  if (_knowledgeDb) return _knowledgeDb;
  ensureDir();
  _knowledgeDb = new Database(KNOWLEDGE_DB_PATH);
  _knowledgeDb.pragma('journal_mode = WAL');
  _knowledgeDb.exec(KNOWLEDGE_SCHEMA);
  return _knowledgeDb;
}

function ensureDir(): void {
  if (!existsSync(VIGILANT_DIR)) {
    mkdirSync(VIGILANT_DIR, { recursive: true, mode: 0o700 });
  }
}
