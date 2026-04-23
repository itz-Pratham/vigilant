# Phase 6 — Git History Researcher

**File:** `src/learner/researchers/git-history-researcher.ts`

## Objective

Read YOUR repo's merged PRs and recent commits, synthesise them into knowledge documents, and store them in `knowledge.db` with `source_type: 'git_history'`. This teaches vigilant how YOUR team writes code — not how the internet thinks code should be written.

---

## Implementation

```typescript
// src/learner/researchers/git-history-researcher.ts

import { githubRequest }    from '@/lib/github';
import { addKnowledgeDoc }  from '@/learner/rag-store';
import { info }             from '@/lib/logger';
import type { NeuroLink }   from '@juspay/neurolink';
import type { ResearchResult, ResearchDocument, GitHistoryEntry } from '../types';

/**
 * Reads the last N merged PRs and commits for a repo and stores
 * what we learn about how the team handles domain-relevant code.
 *
 * @param owner     Repo owner
 * @param repo      Repo name
 * @param domain    Active domain (for scoping documents)
 * @param neurolink For summarisation
 * @param limit     Number of merged PRs to read. Default: 20
 */
export async function runGitHistoryResearch(
  owner: string,
  repo: string,
  domain: string,
  neurolink: NeuroLink,
  limit = 20,
): Promise<ResearchResult> {
  const start = Date.now();
  const docs: ResearchDocument[] = [];

  // Fetch merged PRs filtered by domain keywords
  const DOMAIN_KEYWORDS: Record<string, string[]> = {
    payments:    ['payment', 'checkout', 'charge', 'webhook', 'idempotency'],
    security:    ['auth', 'token', 'secret', 'password', 'sanitize', 'validate'],
    reliability: ['timeout', 'retry', 'circuit', 'fallback', 'resilience'],
    compliance:  ['audit', 'gdpr', 'pii', 'retention', 'anonymize', 'delete'],
  };

  const keywords = DOMAIN_KEYWORDS[domain] ?? [];
  const query = keywords.map(k => `"${k}"`).join(' OR ');

  // Search for merged PRs related to this domain
  const searchResponse = await githubRequest(
    o => o.rest.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} is:pr is:merged ${query}`,
      per_page: limit,
      sort: 'updated',
    }),
    'learner'
  );

  for (const pr of searchResponse.data.items) {
    const prKey = `git_history:${owner}/${repo}:pr:${pr.number}`;

    // Skip if already processed
    const { documentExistsByUrl } = await import('@/db/queries/knowledge');
    if (documentExistsByUrl(prKey)) continue;

    // Fetch PR files to see what changed
    const filesResponse = await githubRequest(
      o => o.rest.pulls.listFiles({ owner, repo, pull_number: pr.number, per_page: 20 }),
      'learner'
    ).catch(() => null);

    const filesSummary = filesResponse?.data
      .map(f => `${f.filename} (+${f.additions}/-${f.deletions})`)
      .join(', ') ?? 'files unavailable';

    // Summarise what this PR teaches about team patterns
    const summaryPrompt = `
This merged PR from ${owner}/${repo} is relevant to ${domain} code quality.

PR #${pr.number}: "${pr.title}"
Author: ${pr.user?.login}
Body: ${pr.body?.substring(0, 500) ?? '(no description)'}
Files changed: ${filesSummary}

In 2-3 sentences, describe:
1. What code pattern or practice this PR introduced or fixed
2. What this teaches about how the ${owner}/${repo} team handles ${domain} concerns
`.trim();

    const summary = await neurolink.generate({
      messages: [{ role: 'user', content: summaryPrompt }],
    }).catch(() => null);

    if (!summary) continue;

    const doc: ResearchDocument = {
      title:      `Team pattern: ${pr.title}`,
      url:        prKey,
      content:    `PR #${pr.number} in ${owner}/${repo}:\n${summary.content}`,
      domain,
      sourceType: 'git_history',
      tags:       keywords.filter(k => (pr.title + (pr.body ?? '')).toLowerCase().includes(k)),
    };

    await addKnowledgeDoc(doc, `repo:${owner}/${repo}`);
    docs.push(doc);
    info(`Git history: learned from PR #${pr.number}`, 'learner');
  }

  return {
    topic:      `${domain} patterns from ${owner}/${repo} git history`,
    sourceType: 'git_history',
    documents:  docs,
    durationMs: Date.now() - start,
    itemsAdded: docs.length,
  };
}
```

---

## When It Runs

The git history researcher runs as a learner research job — one of the round-robin source types. It is triggered by the idle learner loop alongside `github_prs`, `engineering_blog`, etc.

It is scoped to the **watched repo only** — vigilant never reads git history from other users' private repos.

---

## Knowledge Scope

All documents from this researcher use scope `repo:owner/name` (not `global`). This means:
- Knowledge learned from `juspay/hyperswitch` is only available when watching that repo
- It does NOT bleed into knowledge used for other repos

---

## Rate Limit Cost

- 1 GitHub Search API call per research job
- ~1 API call per PR (list files)
- ~1 NeuroLink call per PR (summarisation)
- For limit=20: ~21 API calls + 20 AI calls per research job
- Runs on idle ticks only — not on every watcher tick
