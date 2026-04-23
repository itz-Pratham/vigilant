# Phase 3 — Crash Recovery

**File:** `src/agent/recovery.ts`

## Objective

On daemon startup, find all sessions stuck in `investigating` (process was killed mid-loop) and re-enter `runAgentLoop` for each one. The loop resumes from the last saved `iterationCount` and `goalProgress` — no work is repeated.

---

## Implementation

```typescript
// src/agent/recovery.ts

import { findInterruptedSessions } from './stateManager';
import { runAgentLoop }            from './loop';
import { findPackForIssueType }    from './domainContext';
import { createLogger }            from '@/lib/logger';
import type { DomainPack }         from './domainContext';
import type { VigilantConfig }     from '@/lib/config';

const logger = createLogger('recovery');

/**
 * Called once on daemon startup, before the first watcher tick.
 * Resumes any session that was in 'investigating' when the process last died.
 */
export async function resumeInterruptedSessions(
  activePacks: DomainPack[],
  config: VigilantConfig,
): Promise<void> {
  const sessions = findInterruptedSessions();

  if (sessions.length === 0) {
    logger.info('No interrupted sessions to resume');
    return;
  }

  logger.info(`Resuming ${sessions.length} interrupted session(s)`);

  for (const session of sessions) {
    const pack = findPackForIssueType(activePacks, session.issueType);
    if (!pack) {
      logger.warn(`No domain pack found for issueType ${session.issueType} — skipping ${session.sessionId}`);
      continue;
    }
    logger.info(`Resuming ${session.sessionId} at iteration ${session.iterationCount}, goalProgress ${session.goalProgress}`);
    // Fire-and-forget — the loop manages its own errors and marks blocked if needed
    runAgentLoop(session, pack, config).catch(err => {
      logger.error(`Recovery failed for ${session.sessionId}`, { err });
    });
  }
}
```

---

## How Resumption Works Inside the Loop

`runAgentLoop` does not reset `iterationCount` or `goalProgress` when called on a pre-existing session. The loop entry condition is:

```typescript
// src/agent/loop.ts
while (session.iterationCount < config.maxIterations) {
  // ...
}
```

A session resumed at iteration 12 will run for up to `maxIterations - 12` more iterations. `stallState` is initialised fresh (`initialStallState(session.goalProgress)`) so the stall counter starts from zero — the resumed session gets a fair chance.
