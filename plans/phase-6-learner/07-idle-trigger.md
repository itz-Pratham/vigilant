# Phase 6 — Idle Trigger

**File:** `src/learner/idleTrigger.ts` + integration into `src/watcher/index.ts`

## Objective

The learner is passive — it never runs on a schedule. It fires only when the watcher has completed `LEARNER_IDLE_TICKS_TRIGGER` consecutive ticks that found zero new issues. This prevents learning from competing with active detection.

---

## Implementation

```typescript
// src/learner/idleTrigger.ts

import { LEARNER_IDLE_TICKS_TRIGGER } from '../constants.js';

/** Tracks how many consecutive idle ticks have occurred. */
let idleTickCount = 0;

/**
 * Called by the watcher after each tick.
 * @param newIssuesFound - number of new issues this tick produced
 * @returns true if learner should run this tick
 */
export function shouldRunLearner(newIssuesFound: number): boolean {
  if (newIssuesFound > 0) {
    idleTickCount = 0;   // reset on any activity
    return false;
  }

  idleTickCount++;

  if (idleTickCount >= LEARNER_IDLE_TICKS_TRIGGER) {
    idleTickCount = 0;   // reset so next batch of idle ticks triggers again
    return true;
  }

  return false;
}
```

---

## Integration in Watcher Tick Loop

In `src/watcher/index.ts` (Phase 2, `startWatcher()`):

```typescript
import { shouldRunLearner } from '../learner/idleTrigger.js';
import { runLearner }       from '../learner/index.js';

// After dedup + session creation:
const newIssues = deduplicatedIssues.length;

if (shouldRunLearner(newIssues)) {
  // fire-and-forget — does not block next tick
  runLearner(db, kdb, octokit, neurolink, {}).catch(err => {
    logger.warn(`Learner run failed: ${err.message}`);
  });
}
```

---

## Constants

From `src/constants.ts`:
```typescript
/** Number of idle ticks before learner fires. Default: 10 (= ~50 min at 5-min tick). */
export const LEARNER_IDLE_TICKS_TRIGGER = 10;
```

---

## Idle Detection Logic

```
Tick 1: 3 new issues found → idleTickCount = 0, learner = false
Tick 2: 0 new issues      → idleTickCount = 1, learner = false
Tick 3: 0 new issues      → idleTickCount = 2, learner = false
...
Tick 11: 0 new issues     → idleTickCount = 10, learner = TRUE, reset to 0
Tick 12: 0 new issues     → idleTickCount = 1, learner = false
```

---

## Why Fire-and-Forget?

The learner can take 30–60 seconds for AutoResearch calls. Awaiting it would block the watcher tick. Since learning is additive and non-critical, it runs in the background and failures are logged but ignored.
