# Phase 3 — Stall Detection

**File:** `src/agent/stallDetection.ts`

## Objective

Detects when the agent is no longer making progress and terminates the loop. Three consecutive iterations with `goalProgress` improvement < 0.05 → session marked `blocked`. Independent of the hard `maxIterations` cap.

---

## Implementation

```typescript
const MIN_PROGRESS_DELTA = 0.05;
const STALL_THRESHOLD    = 3;
export const HIGH_CONFIDENCE     = 0.7;   // also used in loop.ts to break early

export type StallState = {
  consecutiveStallCount: number;
  lastProgressBaseline: number;
};

export type StallResult =
  | { stalled: false; newState: StallState }
  | { stalled: true;  reason: string };

export function initialStallState(lastKnownProgress = 0.0): StallState {
  return { consecutiveStallCount: 0, lastProgressBaseline: lastKnownProgress };
}

export function checkStall(current: number, state: StallState): StallResult {
  // At or above high confidence — never stalled
  if (current >= HIGH_CONFIDENCE) {
    return { stalled: false, newState: { consecutiveStallCount: 0, lastProgressBaseline: current } };
  }

  const improved = current - state.lastProgressBaseline >= MIN_PROGRESS_DELTA;
  if (improved) {
    return { stalled: false, newState: { consecutiveStallCount: 0, lastProgressBaseline: current } };
  }

  const count = state.consecutiveStallCount + 1;
  if (count >= STALL_THRESHOLD) {
    return {
      stalled: true,
      reason: `No meaningful progress for ${STALL_THRESHOLD} consecutive iterations (goalProgress ≈ ${current.toFixed(2)})`,
    };
  }

  return { stalled: false, newState: { consecutiveStallCount: count, lastProgressBaseline: state.lastProgressBaseline } };
}
```

---

## goalProgress Extraction

```typescript
// src/agent/loop.ts

const PROGRESS_JSON_REGEX = /"goalProgress"\s*:\s*(0?\.\d+|1\.0|0|1)/;
const PROGRESS_NLP_REGEX  = /(?:progress|confidence|certainty)[^\d]*(0?\.\d+|1\.0)/i;

export function extractGoalProgress(response: string, current: number): number {
  const j = response.match(PROGRESS_JSON_REGEX);
  if (j) { const v = parseFloat(j[1]); if (v >= 0 && v <= 1) return v; }
  const n = response.match(PROGRESS_NLP_REGEX);
  if (n) { const v = parseFloat(n[1]); if (v >= 0 && v <= 1) return v; }
  return current; // no change if not found
}
```

---

## Termination Summary

| Mechanism | Trigger | Blocker reason |
|---|---|---|
| Stall detection | 3 iterations, Δprogress < 0.05 | `STALL: <detail>` |
| Max iterations | `iterationCount >= config.maxIterations` (default 20) | `MAX_ITERATIONS_REACHED` |
| High confidence | `goalProgress >= 0.7` | — (loop breaks cleanly, moves to planning) |
