// src/lib/constants.ts

import os from 'node:os';
import path from 'node:path';

// ── Paths ─────────────────────────────────────────────────────────────────────

export const VIGILANT_DIR      = path.join(os.homedir(), '.vigilant');
export const CONFIG_PATH       = path.join(VIGILANT_DIR, 'config.json');
export const STATE_DB_PATH     = path.join(VIGILANT_DIR, 'state.db');
export const KNOWLEDGE_DB_PATH = path.join(VIGILANT_DIR, 'knowledge.db');

// ── Session / Branch / PR naming ──────────────────────────────────────────────

export const SESSION_ID_PREFIX = 'SESS_vigilant';
export const BRANCH_PREFIX     = 'vigilant/fix';
export const PR_TITLE_SUFFIX   = '[vigilant]';

// ── Stage values ──────────────────────────────────────────────────────────────

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

export const MIN_WATCH_INTERVAL_SECONDS          = 30;
export const DEFAULT_WATCH_INTERVAL_SECONDS      = 60;
export const PR_SCAN_PER_PAGE                    = 30;
export const COMMIT_SCAN_PER_PAGE                = 20;
export const PATTERN_SCAN_MIN_INTERVAL_SECONDS   = 300;
export const WATCHER_POLL_INTERVAL_SECONDS        = 60;

// ── Agent loop ────────────────────────────────────────────────────────────────

export const DEFAULT_MAX_ITERATIONS      = 20;
export const GOAL_PROGRESS_THRESHOLD     = 0.7;
export const STALL_MIN_DELTA             = 0.05;
export const STALL_THRESHOLD             = 3;
export const AI_MAX_RETRIES              = 3;
export const AI_RETRY_BASE_MS            = 2000;
export const MAX_SELF_REVIEW_ITERATIONS  = 3;

// ── Executor ──────────────────────────────────────────────────────────────────

export const CI_POLL_INTERVAL_SECONDS = 60;
export const CI_TIMEOUT_SECONDS       = 3600;

// ── MCP Server ────────────────────────────────────────────────────────────────

export const MCP_DEFAULT_PORT = 3741;

// ── Learner ───────────────────────────────────────────────────────────────────

export const LEARNER_IDLE_TICKS_TRIGGER = 10;

// ── Tool Observer ─────────────────────────────────────────────────────────────

/** GitHub usernames of known review-bot accounts that vigilant reads findings from. */
export const TOOL_BOT_USERNAMES: Record<string, 'snyk' | 'coderabbit' | 'dependabot' | 'github_security'> = {
  'snyk-bot':                      'snyk',
  'coderabbitai[bot]':             'coderabbit',
  'dependabot[bot]':               'dependabot',
  'github-advanced-security[bot]': 'github_security',
};
