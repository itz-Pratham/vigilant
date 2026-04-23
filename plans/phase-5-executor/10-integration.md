# Phase 5 — Integration

**File:** Wiring Phase 5 into the daemon and Phase 4 Gate 2.

## Objective

Show exactly how the executor fits into the overall daemon loop. Gate 2 merge call is also in the executor (it's the final step post Gate 2 approval).

---

## Full Phase 3→4→5→Gate2 Flow

```
Watcher detects issue
         │
         ▼
Phase 3: runAgentLoop()
  → stage: 'investigating' → 'planning'
         │
         ▼
Phase 4: enqueueGate(GATE_1, sessionId)
  → stage: 'awaiting_self_review' → 'self_reviewing' → 'awaiting_approval'
         │
    [Human: vigilant status / session <id>]
    Gate 1 prompt: approve / modify / skip
         │
    approved                  skipped / modified→replanned
         │                         │
         ▼                         ▼
   stage = 'executing'       stage = 'awaiting_approval' (re-queued)
         │
         ▼
Phase 5: runExecutor() [daemon picks up 'executing' sessions]
  → createBranch()
  → writeAllChanges()
  → createPR()
  → monitorCI()
         │
    CI pass               CI fail
         │                    │
         ▼                    ▼
  stage = 'awaiting_merge'   stage = 'blocked'
         │
         ▼
Phase 4: enqueueGate(GATE_2, sessionId)
  [Human: Gate 2 prompt: merge / review / close]
         │
    merge                 close
         │                   │
         ▼                   ▼
  mergePR()            closePR()
  stage = 'merged'     stage = 'closed'
```

---

## Daemon Tick Integration

In the daemon loop (called every `WATCHER_POLL_INTERVAL_MS`):

```typescript
// After watcher tick:

// 1. Run executor for all executing sessions (parallel)
const approvedSessions = listSessionsByStage(db, 'executing');
await Promise.allSettled(
  approvedSessions.map(s => runExecutor(s, octokit, neurolink))
);

// 2. Queue Gate 2 for any sessions now awaiting_merge
const mergeSessions = listSessionsByStage(db, 'awaiting_merge');
for (const s of mergeSessions) {
  if (!isGateQueued(s.sessionId)) {
    await enqueueGate({ type: 'GATE_2', sessionId: s.sessionId });
  }
}
```

---

## Gate 2 Merge Execution

When Gate 2 is approved (`'merge'` decision), `gateTwo()` calls:

```typescript
// src/hitl/gate2.ts — already defined in Phase 4
await octokit.pulls.merge({
  owner:        session.owner,
  repo:         session.repo,
  pull_number:  session.prNumber!,
  merge_method: 'squash',
  commit_title: `fix(${session.issueType.toLowerCase()}): ${session.plan!.summary} [vigilant]`,
});
db.prepare(`UPDATE agent_sessions SET stage = 'merged' WHERE session_id = ?`)
  .run(session.sessionId);
```

---

## New SQLite Columns Added This Phase

```sql
-- Added to agent_sessions in Phase 5 (via migration in getStateDb()):
ALTER TABLE agent_sessions ADD COLUMN executor_step TEXT DEFAULT 'not_started';
ALTER TABLE agent_sessions ADD COLUMN pr_number     INTEGER;
ALTER TABLE agent_sessions ADD COLUMN pr_url        TEXT;
ALTER TABLE agent_sessions ADD COLUMN ci_status     TEXT DEFAULT 'pending';
```
