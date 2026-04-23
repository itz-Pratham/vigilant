# Phase 1 — Integration

**How Phase 1 integrates with every other phase.**

## What Phase 1 Provides to All Other Phases

Every other phase imports from Phase 1. Nothing imports from other phases during Phase 1. Phase 1 is the foundation — it has no runtime dependencies on Phases 2–8.

---

## Import Map

```
Phase 2 (Watcher) imports from Phase 1:
  @/lib/github          ← getGitHub(), conditionalGet(), githubRequest()
  @/lib/logger          ← info(), warn(), error()
  @/lib/constants       ← MIN_INTERVAL, DEFAULT_INTERVAL, VIGILANT_DIR
  @/lib/errors          ← GitHubAPIError, GitHubRateLimitError
  @/config/index        ← loadConfig()
  @/db/queries/watcher  ← getWatcherState(), upsertWatcherState()
  @/db/queries/sessions ← activeSessionExists(), getNextRunNumber()

Phase 3 (Agent) imports from Phase 1:
  @/lib/github          ← githubRequest()
  @/lib/logger          ← info(), error()
  @/lib/constants       ← MAX_ITERATIONS, GOAL_PROGRESS_THRESHOLD, STALL_THRESHOLD
  @/lib/errors          ← AIProviderError, DatabaseError
  @/config/index        ← loadConfig()
  @/db/queries/sessions ← createSession(), getSession(), saveSession(), listSessionsByStage()
  @/db/queries/knowledge← searchDocuments()

Phase 4 (HITL) imports from Phase 1:
  @/lib/logger          ← info()
  @/db/queries/sessions ← listSessions(), getSession(), saveSession()

Phase 5 (Executor) imports from Phase 1:
  @/lib/github          ← githubRequest()
  @/lib/logger          ← info(), error()
  @/lib/errors          ← ExecutorError
  @/db/queries/sessions ← getSession(), saveSession()

Phase 6 (Learner) imports from Phase 1:
  @/lib/logger          ← info()
  @/config/index        ← loadConfig()
  @/db/queries/knowledge← insertDocument(), documentExistsByUrl()
  @/db/queries/sessions ← learning_topics queries

Phase 7 (MCP Server) imports from Phase 1:
  @/lib/logger          ← info()
  @/db/queries/sessions ← listSessions(), getSession(), saveSession()
  @/db/queries/knowledge← searchDocuments()

Phase 8 (Domain Packs) imports from Phase 1:
  @/lib/constants       ← domain pack IDs
  @/config/index        ← loadConfig() to read active domains
```

---

## Startup Sequence (used by `vigilant start`)

```
1. loadConfig()                    ← throws ConfigError if not initialised
2. getStateDb()                    ← opens state.db, runs migrations
3. getKnowledgeDb()                ← opens knowledge.db, runs migrations
4. loadDomainPacks(config.domains) ← Phase 8: loads pattern rules + seeds
5. startWatcher(repo, domain)      ← Phase 2: begins daemon loop
```

This sequence is orchestrated in `src/cli/commands/start.ts` — not in Phase 1 itself.

---

## Error Propagation Contract

All errors thrown by Phase 1 modules are typed `VigilantError` subclasses. Callers handle them as follows:

| Error class | How callers handle it |
|---|---|
| `ConfigError` | Print message to stderr, exit code 1 |
| `GitHubRateLimitError` | Backoff in `githubRequest()` wrapper, transparent to caller |
| `GitHubAPIError` | Log as ERROR, mark session `blocked` (in agent) or skip tick (in watcher) |
| `DatabaseError` | Log as ERROR, crash with exit code 1 (DB corruption is fatal) |
| `AIProviderError` | Log as ERROR, mark session `blocked` |
| `ExecutorError` | Log as ERROR, mark session `blocked` with `step` in `blockerReason` |
