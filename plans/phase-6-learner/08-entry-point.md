# Phase 6 — Learner Entry Point

**File:** `src/learner/index.ts`

## Objective

`runLearner()` is the single entry point for Phase 6. It picks one topic from the queue, dispatches to the right researcher (GitHub or web), stores results, and returns a `ResearchResult`.

---

## Implementation

```typescript
// src/learner/index.ts
import Database            from 'better-sqlite3';
import { Octokit }         from '@octokit/rest';
import { NeuroLink }       from '@juspay/neurolink';
import { LearningTopic, ResearchDocument, ResearchResult } from './types.js';
import { getNextTopic, markTopicRun, seedTopics } from './topicQueue.js';
import { searchMergedPRs, searchAdvisories }       from './githubResearcher.js';
import { researchEngBlog, researchCVE }            from './webResearcher.js';
import { storeResearchResults }                    from './ragStore.js';

type LearnerOptions = {
  customTopic?: string;   // override queue with a specific topic string
  domain?:      string;   // restrict to one domain (for --domain flag)
  owner?:       string;   // repo owner — required for git_history and team_decisions sources
  repo?:        string;   // repo name  — required for git_history and team_decisions sources
};

export async function runLearner(
  db:        Database.Database,
  kdb:       Database.Database,
  octokit:   Octokit,
  neurolink: NeuroLink,
  opts:      LearnerOptions = {},
): Promise<ResearchResult> {
  seedTopics(db);

  const startMs = Date.now();

  // Pick topic
  let topic: LearningTopic | null = getNextTopic(db);
  if (!topic) {
    return { topic: 'none', sourceType: 'github_prs', documents: [], durationMs: 0, itemsAdded: 0 };
  }

  // Override with custom topic if provided
  if (opts.customTopic) {
    topic = { ...topic, topic: opts.customTopic };
  }

  if (opts.domain) {
    topic = { ...topic, domain: opts.domain };
  }

  // Research
  let docs: ResearchDocument[] = [];

  switch (topic.sourceType) {
    case 'github_prs':
      docs = await searchMergedPRs(octokit, neurolink, topic);
      break;

    case 'github_advisories':
      docs = await searchAdvisories(octokit, neurolink, topic);
      break;

    case 'engineering_blog':
      docs = await researchEngBlog(neurolink, topic);
      break;

    case 'cve_database':
      docs = await researchCVE(neurolink, topic);
      break;

    case 'trending_repos':
      // Trending: use GitHub search for repos with domain keywords + good star count
      docs = await searchMergedPRs(octokit, neurolink, {
        ...topic,
        topic: `${topic.domain} best practices stars:>100`,
        sourceType: 'github_prs',
      });
      break;

    case 'git_history': {
      const { runGitHistoryResearch } = await import('./researchers/git-history-researcher.js');
      if (!opts.owner || !opts.repo) break;  // silently skip if no repo context
      const result = await runGitHistoryResearch(opts.owner, opts.repo, topic.domain, neurolink);
      docs = result.documents;
      break;
    }

    case 'team_decisions': {
      const { runDecisionDocResearch } = await import('./researchers/decision-doc-researcher.js');
      if (!opts.owner || !opts.repo) break;  // silently skip if no repo context
      const result = await runDecisionDocResearch(opts.owner, opts.repo, topic.domain, neurolink);
      docs = result.documents;
      break;
    }
  }

  // Store
  const itemsAdded = await storeResearchResults(db, neurolink, docs);

  // Mark topic as completed (regardless of items added — avoid retry loops)
  markTopicRun(db, topic.id);

  return {
    topic:      topic.topic,
    sourceType: topic.sourceType,
    documents:  docs,
    durationMs: Date.now() - startMs,
    itemsAdded,
  };
}
```

---

## runLearner() Call Sites

| Caller | When | How |
|---|---|---|
| `src/watcher/index.ts` | After idle ticks ≥ threshold | `runLearner(...).catch(...)` (fire-and-forget) |
| `src/commands/learn.ts` | `vigilant learn` CLI | `await runLearner(...)` |
| Future: `vigilant start --learn-on-boot` | Startup | `await runLearner(...)` once before watcher loop |
