// src/hitl/gate-queue.ts
// Serialises Gate 1 and Gate 2 prompts — only one prompt displayed at a time.
// Multiple sessions reaching a gate stage simultaneously are queued FIFO.

import { getStateDb }          from '../db/index.js';
import { getSession }          from '../db/queries/sessions.js';
import { info, warn }          from '../lib/logger.js';
import { gateOne }             from './plan-approval.js';
import { gateTwo }             from './merge-approval.js';
import type { PendingGate }    from './types.js';
import type { VigilantConfig } from '../config/types.js';

const queue: PendingGate[] = [];
let processing = false;

/**
 * Add a session to the gate queue.
 * Called by the daemon when a session transitions to awaiting_approval or awaiting_merge.
 * Idempotent — silently ignores duplicate enqueues for the same session+gate.
 */
export function enqueueGate(sessionId: string, gate: 1 | 2): void {
  if (queue.some(p => p.sessionId === sessionId && p.gate === gate)) return;

  queue.push({ sessionId, gate, enqueuedAt: new Date().toISOString() });
  info(`Gate ${gate} queued for ${sessionId} (depth: ${queue.length})`, 'hitl');

  if (!processing) {
    processQueue().catch(err => warn(`Gate queue error: ${(err as Error).message}`, 'hitl'));
  }
}

/**
 * Re-queue any sessions that were at a gate stage when the daemon last stopped.
 * Call once at daemon startup after database is ready.
 */
export function reQueuePendingGates(): void {
  const rows = getStateDb().prepare(`
    SELECT session_id, stage FROM agent_sessions
    WHERE stage IN ('awaiting_approval', 'awaiting_merge')
  `).all() as Array<{ session_id: string; stage: string }>;

  for (const row of rows) {
    enqueueGate(row.session_id, row.stage === 'awaiting_approval' ? 1 : 2);
  }

  if (rows.length > 0) {
    info(`Re-queued ${rows.length} pending gate(s) from previous run`, 'hitl');
  }
}

// ── Queue processor ───────────────────────────────────────────────────────────

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  const { loadConfig }        = await import('../config/index.js');
  const { resolveActivePacks, findPackForIssueType } = await import('../agent/domain-context.js');

  let config: VigilantConfig;
  try {
    config = loadConfig();
  } catch {
    warn('Gate queue: cannot load config — aborting', 'hitl');
    processing = false;
    return;
  }

  const allPacks = resolveActivePacks(config);

  while (queue.length > 0) {
    const pending = queue.shift()!;
    const session = getSession(pending.sessionId);

    if (!session) {
      warn(`Queued session ${pending.sessionId} not found — skipping`, 'hitl');
      continue;
    }

    // Session stage may have changed while queued (e.g. approved via CLI)
    const expectedStage = pending.gate === 1 ? 'awaiting_approval' : 'awaiting_merge';
    if (session.stage !== expectedStage) {
      info(`Session ${pending.sessionId} no longer at gate (stage: ${session.stage}) — skipping`, 'hitl');
      continue;
    }

    try {
      if (pending.gate === 1) {
        const pack = allPacks.find(p => p.id === session.domain)
          ?? findPackForIssueType(session.issueType)
          ?? allPacks[0];
        if (!pack) { warn(`No pack for ${session.issueType} — skipping gate 1`, 'hitl'); continue; }
        await gateOne(session, pack, config);
      } else {
        await gateTwo(session);
      }
    } catch (err) {
      warn(`Gate ${pending.gate} failed for ${pending.sessionId}: ${(err as Error).message}`, 'hitl');
    }
  }

  processing = false;
}
