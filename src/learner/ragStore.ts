// src/learner/ragStore.ts
// Stores research documents into knowledge_documents with scope and URL dedup.

import { randomUUID }               from 'crypto';
import { addKnowledgeDocument, documentExistsByUrl } from '../db/queries/knowledge.js';
import type { ResearchDocument }    from './types.js';

/** Maps learner source types to knowledge_documents.source_type values. */
function toKnowledgeSourceType(learnerType: string): 'github_repo' | 'web' {
  if (learnerType === 'github_prs' || learnerType === 'github_advisories') return 'github_repo';
  return 'web';
}

/**
 * Stores a batch of research documents into knowledge_documents.
 * Silently skips any document whose URL already exists (idempotent / dedup).
 * Returns the count of newly added documents.
 */
export function storeResearchResults(
  docs:       ResearchDocument[],
  scope:      string,
  topic:      string,
): number {
  let added = 0;
  const now = new Date().toISOString();

  for (const doc of docs) {
    if (documentExistsByUrl(doc.url)) continue;

    const inserted = addKnowledgeDocument({
      id:         randomUUID(),
      scope,
      domain:     doc.domain,
      topic,
      sourceUrl:  doc.url,
      sourceType: toKnowledgeSourceType(doc.sourceType),
      title:      doc.title,
      content:    doc.content,
      keyPoints:  doc.tags,
      confidence: 1.0,
      learnedAt:  now,
      createdAt:  now,
    });

    if (inserted) added++;
  }

  return added;
}
