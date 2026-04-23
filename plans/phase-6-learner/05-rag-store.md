# Phase 6 — RAG Store

**File:** `src/learner/ragStore.ts`

## Objective

Wrap NeuroLink's `addDocument()` with:
1. URL-based deduplication (don't add the same URL twice)
2. Mandatory `scope` field (`'global'` for all learner documents)
3. Metadata tagging so searches can filter by domain and tags

---

## Implementation

```typescript
// src/learner/ragStore.ts
import Database              from 'better-sqlite3';
import { NeuroLink }         from '@juspay/neurolink';
import { ResearchDocument }  from './types.js';

/**
 * Adds a research document to the NeuroLink RAG store.
 * No-ops if the URL was already added (deduplication).
 * Returns true if added, false if skipped.
 */
export async function addKnowledgeDocument(
  db:        Database.Database,
  neurolink: NeuroLink,
  doc:       ResearchDocument,
): Promise<boolean> {
  // 1. Check dedup table
  const exists = db.prepare(`SELECT 1 FROM learned_urls WHERE url = ?`).get(doc.url);
  if (exists) return false;

  // 2. Add to NeuroLink RAG
  await neurolink.addDocument({
    content:  doc.content,
    metadata: {
      title:  doc.title,
      url:    doc.url,
      domain: doc.domain,
      tags:   doc.tags.join(','),
      scope:  'global',     // all learner documents are global (not repo-specific)
      addedAt: Date.now().toString(),
    },
  });

  // 3. Mark URL as seen
  db.prepare(`INSERT INTO learned_urls (url, domain, added_at) VALUES (?, ?, ?)`)
    .run(doc.url, doc.domain, Date.now());

  return true;
}

/**
 * Processes all docs from a research run. Returns count of newly added.
 */
export async function storeResearchResults(
  db:        Database.Database,
  neurolink: NeuroLink,
  docs:      ResearchDocument[],
): Promise<number> {
  let added = 0;

  for (const doc of docs) {
    const wasAdded = await addKnowledgeDocument(db, neurolink, doc);
    if (wasAdded) added++;
  }

  return added;
}
```

---

## Scope Enforcement

All learner documents get `scope: 'global'`. This means they are returned in RAG searches for ANY repository — they represent universal best practices, not repo-specific knowledge.

Repo-specific knowledge (learned by the agent during investigation) gets `scope: 'repo:{owner}/{name}'`. The two never mix.

---

## NeuroLink addDocument() Signature

From the NeuroLink SDK (based on the repo structure):
```typescript
neurolink.addDocument({
  content:  string,
  metadata: Record<string, string>,
}): Promise<void>
```

Documents are chunked and embedded automatically by NeuroLink. The `metadata` fields are returned during search and can be used for filtering.

---

## Knowledge Database

The RAG store uses the NeuroLink-managed knowledge database at `~/.vigilant/knowledge.db` (path passed during NeuroLink init). This is separate from `state.db`.

```typescript
// In src/db/knowledge.ts:
export function getKnowledgeDb(dir: string) {
  const path = join(dir, 'knowledge.db');
  return new Database(path);
}

// NeuroLink init (from Phase 3):
const neurolink = new NeuroLink({
  providers: [...],
  rag: { db: knowledgeDb },
});
```
