# Phase 4 — Gate Queue

**File:** `src/hitl/gateQueue.ts`

## Objective

When multiple sessions reach `awaiting_approval` simultaneously, the daemon must not display multiple concurrent `inquirer` prompts (they collide on stdin). The gate queue serialises gate prompts — one at a time, FIFO.

---

## Implementation

```typescript
// src/hitl/gateQueue.ts

import { loadSession }           from '@/agent/stateManager';
import { loadActiveDomainPacks,
         findPackForIssueType }  from '@/agent/domainContext';
import { gateOne }               from './plan-approval';
import { gateTwo }               from './merge-approval';
import { info, warn }            from '@/lib/logger';
import type { VigilantConfig }   from '@/config/types';
import type { PendingGate }      from './types';

const queue: PendingGate[] = [];
let processing = false;

/**
 * Add a session to the gate queue.
 * Called by the daemon when a session transitions to 'awaiting_approval'
 * or 'awaiting_merge'.
 */
export function enqueueGate(sessionId: string, gate: 1 | 2): void {
  // Avoid duplicates — a session may transition twice if the daemon restarts
  if (queue.some(p => p.sessionId === sessionId && p.gate === gate)) return;

  queue.push({ sessionId, gate, enqueuedAt: new Date().toISOString() });
  info(`Gate ${gate} queued for ${sessionId} (queue depth: ${queue.length})`, 'hitl');

  // Kick off processing if not already running
  if (!processing) processQueue().catch(err => {
    warn(`Gate queue error: ${(err as Error).message}`, 'hitl');
  });
}

async function processQueue(config?: VigilantConfig): Promise<void> {
  if (processing) return;
  processing = true;

  // Lazy-load config if not provided (avoids circular dep at module load time)
  const { loadConfig }           = await import('@/config');
  const { loadActiveDomainPacks } = await import('@/agent/domainContext');
  const cfg    = config ?? loadConfig();
  const packs  = loadActiveDomainPacks(cfg);

  while (queue.length > 0) {
    const pending = queue.shift()!;
    const session = loadSession(pending.sessionId);

    if (!session) {
      warn(`Queued session ${pending.sessionId} not found in SQLite — skipping`, 'hitl');
      continue;
    }

    // Session stage may have changed while queued (e.g. approved via CLI)
    if (session.stage !== 'awaiting_approval' && session.stage !== 'awaiting_merge') {
      info(`Session ${pending.sessionId} no longer at gate (stage: ${session.stage}) — skipping`, 'hitl');
      continue;
    }

    try {
      if (pending.gate === 1) {
        const pack = findPackForIssueType(packs, session.issueType);
        if (!pack) { warn(`No pack for ${session.issueType}`, 'hitl'); continue; }
        await gateOne(session, pack, cfg);
      } else {
        await gateTwo(session);
      }
    } catch (err) {
      warn(`Gate ${pending.gate} failed for ${pending.sessionId}: ${(err as Error).message}`, 'hitl');
    }
  }

  processing = false;
}
```

---

## Startup Re-queue

On daemon startup, any sessions already at `awaiting_approval` or `awaiting_merge` (from before a restart) are re-queued:

```typescript
// src/hitl/gateQueue.ts

export function reQueuePendingGates(): void {
  const { getStateDb } = require('@/db');
  const rows = getStateDb().prepare(`
    SELECT session_id, stage FROM agent_sessions
    WHERE stage IN ('awaiting_approval', 'awaiting_merge')
  `).all() as Array<{ session_id: string; stage: string }>;

  for (const row of rows) {
    enqueueGate(row.session_id, row.stage === 'awaiting_approval' ? 1 : 2);
  }
}
```
