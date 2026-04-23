# Phase 1 — Constants

**File:** `src/lib/constants.ts`

## Objective

Every magic string and magic number in the codebase lives here. No inline literals anywhere except inside this file. Importing from `@/lib/constants` is the only permitted way to use these values.

---

## Implementation

```typescript
// src/lib/constants.ts

import os from 'node:os';
import path from 'node:path';

// ── Paths ─────────────────────────────────────────────────────────────────────

/** Root directory for all vigilant data: ~/.vigilant/ */
export const VIGILANT_DIR      = path.join(os.homedir(), '.vigilant');
export const CONFIG_PATH       = path.join(VIGILANT_DIR, 'config.json');
export const STATE_DB_PATH     = path.join(VIGILANT_DIR, 'state.db');
export const KNOWLEDGE_DB_PATH = path.join(VIGILANT_DIR, 'knowledge.db');

// ── Session IDs ───────────────────────────────────────────────────────────────

/** Prefix for all session IDs. Full format: SESS_vigilant_{TYPE}_{owner}_{repo}_{NNN} */
export const SESSION_ID_PREFIX = 'SESS_vigilant';

// ── Stage Values ──────────────────────────────────────────────────────────────

/** All valid IssueStage string values, as a const object for use in SQL and switch guards. */
export const STAGE = {
  DISCOVERED:           'discovered',
  INVESTIGATING:        'investigating',
  PLANNING:             'planning',
  AWAITING_SELF_REVIEW: 'awaiting_self_review',
  SELF_REVIEWING:       'self_reviewing',
  AWAITING_APPROVAL:    'awaiting_approval',
  EXECUTING:            'executing',
  PR_CREATED:           'pr_created',
  AWAITING_MERGE:       'awaiting_merge',
  MERGED:               'merged',
  SKIPPED:              'skipped',
  CLOSED:               'closed',
  BLOCKED:              'blocked',
} as const;

export const TERMINAL_STAGES = [STAGE.MERGED, STAGE.SKIPPED, STAGE.CLOSED] as const;

// ── Watcher ───────────────────────────────────────────────────────────────────

/** Minimum allowed watch interval (seconds). Enforced at config validation. */
export const MIN_WATCH_INTERVAL_SECONDS     = 30;
/** Default watch interval if not set in config. */
export const DEFAULT_WATCH_INTERVAL_SECONDS = 60;
/** How many PRs to fetch per tick (GitHub API per_page). */
export const PR_SCAN_PER_PAGE               = 30;
/** How many commits to fetch per tick. */
export const COMMIT_SCAN_PER_PAGE           = 20;
/** Minimum seconds between pattern scanner runs (GitHub Search is 30 req/min). */
export const PATTERN_SCAN_MIN_INTERVAL_SECONDS = 300;

// ── Agent Loop ────────────────────────────────────────────────────────────────

/** Default max agentic loop iterations per session. Overridable in config. */
export const DEFAULT_MAX_ITERATIONS        = 20;
/** goalProgress at or above this → agent is confident, move to planning. */
export const GOAL_PROGRESS_THRESHOLD       = 0.7;
/** Minimum per-iteration progress improvement to avoid stall detection. */
export const STALL_MIN_DELTA               = 0.05;
/** Consecutive stall iterations before marking blocked. */
export const STALL_THRESHOLD              = 3;
/** Max AI call retries with exponential backoff before marking blocked. */
export const AI_MAX_RETRIES               = 3;
export const AI_RETRY_BASE_MS             = 2000;
/** Max self-review iterations before handing off to Gate 1. */
export const MAX_SELF_REVIEW_ITERATIONS   = 3;

// ── Executor ─────────────────────────────────────────────────────────────────

/** Prefix for all branches created by vigilant. */
export const BRANCH_PREFIX          = 'vigilant/fix';
/** String appended to every PR title. */
export const PR_TITLE_SUFFIX        = '[vigilant]';
/** How often the CI monitor polls GitHub Actions (seconds). */
export const CI_POLL_INTERVAL_SECONDS = 60;
/** Max time to wait for CI before marking session blocked (seconds). */
export const CI_TIMEOUT_SECONDS     = 3600; // 1 hour

// ── MCP Server ────────────────────────────────────────────────────────────────

export const MCP_DEFAULT_PORT = 3741;

// ── Learner ───────────────────────────────────────────────────────────────────

/** How many idle ticks before the learner runs a research job. */
export const LEARNER_IDLE_TICKS_TRIGGER = 10;
```
