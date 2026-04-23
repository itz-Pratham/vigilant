# Phase 6 — Learner Types

**File:** `src/learner/types.ts`

## Objective

Types used across the learner subsystem. The learner covers all six knowledge sources; the types reflect the two new sources added by the concept pivot: git history reader and decision doc reader.

---

## Implementation

```typescript
// src/learner/types.ts

/** One entry in the learning_topics SQLite table. */
export type LearningTopic = {
  id:         number;
  domain:     string;       // 'payments' | 'security' | 'reliability' | 'compliance'
  topic:      string;       // e.g. 'idempotency keys'
  sourceType: SourceType;
  lastRunAt:  number | null; // unix timestamp ms, null = never run
  runCount:   number;
};

/**
 * Where to search for this topic.
 * Maps to the 6 knowledge sources in the Knowledge Stack.
 */
export type SourceType =
  | 'github_prs'          // merged PRs on GitHub Search (source 5: other repos)
  | 'github_advisories'   // GitHub Security Advisories (source 5: other repos)
  | 'engineering_blog'    // Stripe/Razorpay/Juspay/Netflix/Uber via AutoResearch (source 6: web)
  | 'cve_database'        // NVD CVE via AutoResearch (source 6: web)
  | 'trending_repos'      // GitHub trending with domain keywords (source 5: other repos)
  | 'git_history'         // YOUR repo's merged PRs and commits (source 2: git history)
  | 'team_decisions';     // decision.md, adr/, docs/ from YOUR repo (source 3: team decisions)

/** Result of one research run. */
export type ResearchResult = {
  topic:       string;
  sourceType:  SourceType;
  documents:   ResearchDocument[];
  durationMs:  number;
  itemsAdded:  number;
};

/** One document produced by a research run. */
export type ResearchDocument = {
  title:      string;
  url:        string;
  content:    string;       // summarised markdown, max 4000 chars
  domain:     string;
  sourceType: SourceType;   // stored in knowledge_documents.source_type
  tags:       string[];     // keywords extracted during summarisation
};

/** Result of reading git history from the watched repo. */
export type GitHistoryEntry = {
  sha:     string;
  message: string;
  author:  string | undefined;
  date:    string | undefined;
  url:     string;
  /** Files changed in this commit, if available */
  files?:  string[];
};

/** Result of reading a team decision document. */
export type TeamDecisionDoc = {
  path:    string;
  content: string;
  sha:     string;
};
```

---

## SQLite Schema

```sql
CREATE TABLE IF NOT EXISTS learning_topics (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  domain       TEXT NOT NULL,
  topic        TEXT NOT NULL,
  source_type  TEXT NOT NULL,   -- includes 'git_history' and 'team_decisions'
  last_run_at  INTEGER,         -- unix timestamp ms, null = never
  run_count    INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS learned_urls (
  url        TEXT PRIMARY KEY,    -- dedup guard
  domain     TEXT NOT NULL,
  added_at   INTEGER NOT NULL
);
```

Both tables live in `~/.vigilant/state.db`. Created by `getStateDb()` on first run.
