// src/hitl/types.ts

import type { CIStatus } from '../agent/types.js';

/** What the human decided at Gate 1. */
export type Gate1Decision = 'approved' | 'modified' | 'skipped';

/** What the human decided at Gate 2. */
export type Gate2Decision = 'merged' | 'review' | 'closed';

/**
 * A single section inside the terminal box.
 * The renderer stacks sections vertically, separated by ╠═╣ dividers.
 */
export type RendererSection = {
  /** Optional section header (e.g. "PLAN"). Rendered in caps. */
  heading?: string;
  /** Lines to display inside this section. Each string is one line. */
  lines: string[];
};

/** Severity colour mapping for the box border and title. */
export type SeverityColour = 'red' | 'yellow' | 'cyan' | 'grey';

/**
 * A pending gate — stored in memory by the gate queue.
 * Not persisted to SQLite; if the daemon restarts, sessions at
 * 'awaiting_approval' / 'awaiting_merge' are re-queued on startup.
 */
export type PendingGate = {
  sessionId:  string;
  gate:       1 | 2;
  enqueuedAt: string;
};

export type { CIStatus };
