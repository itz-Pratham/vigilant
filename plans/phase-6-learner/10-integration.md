# Phase 6 — Integration

**File:** Wiring Phase 6 into the watcher and daemon startup.

## Objective

Show exactly where the learner hooks into the existing system — watcher idle detection, daemon startup, and the `vigilant learn` CLI command.

---

## Full Integration Points

```
Daemon startup
    │
    ▼
seedTopics(db)          ← ensures learning_topics table is populated
    │
    ▼
Watcher tick loop
    │
    ├── Issues found?
    │       │
    │       YES → process issues, idleTickCount = 0
    │       NO  → idleTickCount++
    │               │
    │               idleTickCount >= LEARNER_IDLE_TICKS_TRIGGER
    │                       │
    │                       ▼
    │               runLearner()   [fire-and-forget]
    │                   │
    │                   ▼
    │               getNextTopic(db)
    │               searchMergedPRs() | researchEngBlog() | ...
    │               storeResearchResults()
    │               markTopicRun(db, topic.id)
    │
    ▼
Next tick (after WATCHER_POLL_INTERVAL_MS)
```

---

## Startup Sequence Addition

In `src/commands/start.ts` (Phase 2):

```typescript
import { seedTopics }  from '../learner/topicQueue.js';
import { getStateDb }  from '../db/state.js';

// After db init, before watcher loop:
const db = getStateDb();
seedTopics(db);   // idempotent — safe to call every startup
```

---

## New Files Added This Phase

```
src/
└── learner/
    ├── index.ts                            ← runLearner() entry point
    ├── types.ts                            ← LearningTopic, ResearchResult, ResearchDocument, SourceType
    │                                           (includes GitHistoryEntry, TeamDecisionDoc)
    ├── topicQueue.ts                       ← getNextTopic, markTopicRun, seedTopics
    ├── githubResearcher.ts                 ← searchMergedPRs, searchAdvisories
    ├── webResearcher.ts                    ← researchEngBlog, researchCVE
    ├── ragStore.ts                         ← addKnowledgeDocument, storeResearchResults
    ├── dedup.ts                            ← isKnownUrl, getLearnedUrls, forgetUrl
    ├── idleTrigger.ts                      ← shouldRunLearner, idleTickCount
    └── researchers/
        ├── git-history-researcher.ts       ← runGitHistoryResearch() (source 2: git history)
        └── decision-doc-researcher.ts      ← runDecisionDocResearch() (source 3: team decisions)
src/
└── commands/
    └── learn.ts                            ← vigilant learn CLI command
```

---

## New SQLite Tables Added This Phase

```sql
CREATE TABLE IF NOT EXISTS learning_topics (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  domain       TEXT NOT NULL,
  topic        TEXT NOT NULL,
  source_type  TEXT NOT NULL,
  last_run_at  INTEGER,
  run_count    INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS learned_urls (
  url        TEXT PRIMARY KEY,
  domain     TEXT NOT NULL,
  added_at   INTEGER NOT NULL
);
```

Both created in `getStateDb()` alongside existing tables.

---

## New npm Dependencies

```json
// No new dependencies — uses existing:
// @octokit/rest, @juspay/neurolink, better-sqlite3, commander
```

The learner uses only what's already installed.
