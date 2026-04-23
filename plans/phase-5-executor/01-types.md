# Phase 5 — Executor Types

**File:** `src/executor/types.ts`

## Objective

Types used across all executor components. `ExecutorStep` tracks how far execution got so restart can skip already-completed work.

---

## Implementation

```typescript
// src/executor/types.ts

/**
 * Tracks which executor step completed last.
 * Stored as a TEXT column in agent_sessions ('executor_step').
 * On restart, runExecutor() skips all steps at or before this value.
 */
export type ExecutorStep =
  | 'not_started'
  | 'branch_created'
  | 'files_written'
  | 'pr_created'
  | 'ci_monitoring';

/** Context passed to every executor sub-component. */
export type ExecutorContext = {
  owner:      string;
  repo:       string;
  branchName: string;
  /** SHA of the default branch tip — used to create the new branch from. */
  baseSha:    string;
};

/** Result of writing a single file. */
export type FileWriteResult = {
  path:      string;
  commitSha: string;
  success:   boolean;
  error?:    string;
};

/** Live CI check result from GitHub Actions. */
export type CICheckResult = {
  status:   'pending' | 'success' | 'failure' | 'cancelled';
  runId:    number;
  runUrl:   string;
  /** Name of the first failed job, if any. */
  failedJob?: string;
};
```

---

## ExecutorStep in SQLite

The `agent_sessions` schema needs one extra column:

```sql
-- Added to state.db migration (Phase 1 schema updated in Phase 5):
ALTER TABLE agent_sessions ADD COLUMN executor_step TEXT DEFAULT 'not_started';
```

This is added as a migration check in `getStateDb()`:
```typescript
db.exec(`ALTER TABLE agent_sessions ADD COLUMN executor_step TEXT DEFAULT 'not_started'`);
// Wrapped in try/catch — safe to run if column already exists (SQLite returns error, not exception)
```
