# Phase 6 — Decision Doc Researcher

**File:** `src/learner/researchers/decision-doc-researcher.ts`

## Objective

Read team decision documents from the watched repo (`decision.md`, `adr/`, `docs/decisions/`), summarise them into knowledge documents, and store them in `knowledge.db` with `source_type: 'team_decisions'`. This gives vigilant the team's explicit intent — so drift detection knows whether a pattern change was intentional.

---

## Implementation

```typescript
// src/learner/researchers/decision-doc-researcher.ts

import { githubRequest }    from '@/lib/github';
import { addKnowledgeDoc }  from '@/learner/rag-store';
import { info }             from '@/lib/logger';
import type { NeuroLink }   from '@juspay/neurolink';
import type { ResearchResult, ResearchDocument, TeamDecisionDoc } from '../types';

/**
 * Discovers and reads team decision documents from the watched repo.
 * Supports: decision.md, DECISION.md, adr/ directory, docs/decisions/, docs/adr/
 */
export async function runDecisionDocResearch(
  owner: string,
  repo: string,
  domain: string,
  neurolink: NeuroLink,
): Promise<ResearchResult> {
  const start = Date.now();
  const docs: ResearchDocument[] = [];

  const CANDIDATE_PATHS = [
    'decision.md',
    'DECISION.md',
    'decisions.md',
    'adr',
    'docs/decisions',
    'docs/adr',
    'docs/architecture',
    '.adr',
  ];

  const decisionDocs: TeamDecisionDoc[] = [];

  for (const path of CANDIDATE_PATHS) {
    const content = await readPathOrDirectory(owner, repo, path);
    decisionDocs.push(...content);
  }

  if (decisionDocs.length === 0) {
    info(`Decision doc researcher: no decision docs found in ${owner}/${repo}`, 'learner');
    return { topic: 'team decisions', sourceType: 'team_decisions', documents: [], durationMs: Date.now() - start, itemsAdded: 0 };
  }

  for (const decDoc of decisionDocs) {
    const docKey = `team_decision:${owner}/${repo}:${decDoc.path}:${decDoc.sha}`;

    const { documentExistsByUrl } = await import('@/db/queries/knowledge');
    if (documentExistsByUrl(docKey)) continue;  // already processed this version

    // Summarise the decision in context of the active domain
    const summaryPrompt = `
This is a team decision document from ${owner}/${repo}.

File: ${decDoc.path}
Content:
${decDoc.content.substring(0, 2000)}

Summarise the key decisions made here that are relevant to ${domain} code quality.
Focus on: explicit patterns the team decided to use, anti-patterns they decided to avoid,
and any explicit decisions about ${domain}-related code conventions.
If this document has no relevance to ${domain}, say "Not relevant to ${domain}."
`.trim();

    const summary = await neurolink.generate({
      messages: [{ role: 'user', content: summaryPrompt }],
    }).catch(() => null);

    if (!summary || summary.content.includes('Not relevant')) continue;

    const doc: ResearchDocument = {
      title:      `Team decision: ${decDoc.path}`,
      url:        docKey,
      content:    `Team decision in ${owner}/${repo} (${decDoc.path}):\n${summary.content}`,
      domain,
      sourceType: 'team_decisions',
      tags:       [domain, 'team-decision', 'architecture'],
    };

    await addKnowledgeDoc(doc, `repo:${owner}/${repo}`);
    docs.push(doc);
    info(`Decision docs: learned from ${decDoc.path}`, 'learner');
  }

  return {
    topic:      `team decisions from ${owner}/${repo}`,
    sourceType: 'team_decisions',
    documents:  docs,
    durationMs: Date.now() - start,
    itemsAdded: docs.length,
  };
}

// ── Path reader helpers ──────────────────────────────────────────────────

async function readPathOrDirectory(
  owner: string,
  repo: string,
  path: string,
): Promise<TeamDecisionDoc[]> {
  try {
    const response = await githubRequest(
      o => o.rest.repos.getContent({ owner, repo, path }),
      'learner'
    );
    const data = response.data;

    if (Array.isArray(data)) {
      // Directory — fetch each markdown file
      const mdFiles = data.filter(f => f.type === 'file' && f.name.endsWith('.md'));
      const results: TeamDecisionDoc[] = [];
      for (const file of mdFiles.slice(0, 10)) {  // cap at 10 files per directory
        const fileResults = await readPathOrDirectory(owner, repo, file.path);
        results.push(...fileResults);
      }
      return results;
    }

    if ('content' in data) {
      return [{
        path:    data.path,
        content: Buffer.from(data.content, 'base64').toString('utf-8'),
        sha:     data.sha,
      }];
    }

    return [];
  } catch {
    return [];  // file/directory not found — silently skip
  }
}
```

---

## SHA-based Deduplication

Decision documents use `sha` in their knowledge URL key:
```
team_decision:owner/repo:adr/001-idempotency.md:{sha}
```

When the file is updated (new commit changes the ADR), the SHA changes → a new document is stored with updated content. The old version remains in the knowledge base but is superseded by recency in RAG search results.

---

## When It Runs

The decision doc researcher runs as a learner research job on idle ticks, same as git history and GitHub PR researchers. It runs less frequently than other sources because team decision docs change slowly — one run per 7 idle ticks is sufficient (controlled by the topic queue `last_run_at`).

---

## Knowledge Scope

All documents use scope `repo:owner/name` — strictly private to the watched repo. Team decisions from one repo never affect vigilant's knowledge for another repo.

---

## Rate Limit Cost

- 1–10 API calls per research job (directory listings + file reads)
- ~1 NeuroLink call per relevant document found
- Low-cost operation — team decision docs are small and infrequent
