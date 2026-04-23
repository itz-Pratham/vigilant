# Phase 4 — Integration

**File:** `src/hitl/index.ts`

## Objective

Phase 4's public exports. The daemon calls `enqueueGate()` after a session transitions to a gate stage. CLI commands import `gateOne` and `gateTwo` directly for the `session <id>` command.

---

## Imports from Other Phases

| Import | From |
|---|---|
| `loadSession`, `advanceStage`, `markBlocked` | Phase 3 `@/agent/stateManager` |
| `generatePlan` | Phase 3 `@/agent/planGenerator` |
| `IssueSession`, `Plan`, `Severity` | Phase 3 `@/agent/types` |
| `loadActiveDomainPacks`, `findPackForIssueType` | Phase 3 `@/agent/domainContext` |
| `getStateDb` | Phase 1 `@/db` |
| `info`, `warn` | Phase 1 `@/lib/logger` |
| `loadConfig` | Phase 1 `@/config` |
| `GitHubAPIError` | Phase 1 `@/lib/errors` |
| `githubRequest` | Phase 1 `@/lib/github` |

## Exports to Other Phases

| Export | Used by |
|---|---|
| `enqueueGate(sessionId, gate)` | Phase 2 daemon (watcher/index.ts) after agent sets stage |
| `reQueuePendingGates()` | Phase 2 daemon startup |
| `gateOne(session, pack, config)` | Phase 6 session command (`vigilant session <id>`) |
| `gateTwo(session)` | Phase 6 session command |

---

## Public API

```typescript
// src/hitl/index.ts

export { gateOne }            from './plan-approval';
export { gateTwo }            from './merge-approval';
export { enqueueGate,
         reQueuePendingGates } from './gateQueue';
```

---

## How Phases 3 → 4 → 5 Connect

```
Phase 3 (Agent)
  └── runAgentLoop() → session.stage = 'awaiting_approval'
        │
        └── startAgentSession() calls enqueueGate(sessionId, 1)
              │
              Phase 4 (HITL)
              └── gateQueue processes → gateOne() → human approves
                    │
                    └── advanceStage(session, 'executing')
                          │
                          Phase 5 (Executor)
                          └── daemon detects stage='executing' → runExecutor(session)
```

The daemon loop in `src/watcher/index.ts` is the glue:

```typescript
// After startAgentSession resolves:
startAgentSession(issue, activePacks, config, toolFindings)
  .then(session => {
    if (session.stage === 'awaiting_approval') {
      enqueueGate(session.sessionId, 1);
    }
  })
  .catch(err => error(`Session failed: ${err.message}`, 'watcher'));
```

And the executor is triggered when the daemon polls for `executing` sessions:

```typescript
// In watcher tick, after scanners run:
const executingSessions = listActiveSessions(owner, repo)
  .filter(s => s.stage === 'executing');

for (const session of executingSessions) {
  runExecutor(session, config).catch(err => {
    markBlocked(session, `EXECUTOR_FAILED: ${err.message}`);
  });
}
```

---

## Startup Sequence Addition (Phase 4)

```
daemon start
  ├── loadConfig()
  ├── loadActiveDomainPacks(config)
  ├── loadDomainSeeds(pack) × N
  ├── resumeInterruptedSessions(packs)   ← Phase 3
  ├── reQueuePendingGates()              ← Phase 4 ← re-surfaces any pre-restart gates
  └── startWatcher(repo, packs, config)  ← Phase 2
```
