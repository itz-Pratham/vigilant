// src/db/queries/knowledge.ts

import { getKnowledgeDb } from '../index.js';

export type SourceType =
  | 'git_history'
  | 'team_decisions'
  | 'user_feedback'
  | 'github_repo'
  | 'web'
  | 'codebase';

export type KnowledgeDocument = {
  id:         string;
  scope:      string;
  domain:     string;
  topic:      string;
  sourceUrl:  string;
  sourceType: SourceType;
  title:      string;
  content:    string;
  keyPoints:  string[];
  confidence: number;
  learnedAt:  string;
  createdAt:  string;
};

/**
 * Insert a document. Idempotent — silently skips if source_url already exists.
 * Returns true if inserted, false if skipped (already present).
 */
export function addKnowledgeDocument(doc: KnowledgeDocument): boolean {
  const db = getKnowledgeDb();
  const result = db.prepare(`
    INSERT OR IGNORE INTO knowledge_documents
      (id, scope, domain, topic, source_url, source_type, title, content, key_points, confidence, learned_at, created_at)
    VALUES
      (@id, @scope, @domain, @topic, @sourceUrl, @sourceType, @title, @content, @keyPoints, @confidence, @learnedAt, @createdAt)
  `).run({
    id:         doc.id,
    scope:      doc.scope,
    domain:     doc.domain,
    topic:      doc.topic,
    sourceUrl:  doc.sourceUrl,
    sourceType: doc.sourceType,
    title:      doc.title,
    content:    doc.content,
    keyPoints:  JSON.stringify(doc.keyPoints),
    confidence: doc.confidence,
    learnedAt:  doc.learnedAt,
    createdAt:  doc.createdAt,
  });
  return result.changes > 0;
}

/**
 * Full-text search over title + content within a scope and domain.
 * scope is required — knowledge is always scoped (either 'global' or 'repo:owner/name').
 */
export function searchDocuments(params: {
  scope:    string;
  domain:   string;
  query:    string;
  limit?:   number;
}): KnowledgeDocument[] {
  const db    = getKnowledgeDb();
  const limit = params.limit ?? 10;
  const like  = `%${params.query}%`;

  const rows = db.prepare(`
    SELECT * FROM knowledge_documents
    WHERE scope = ? AND domain = ?
    AND (title LIKE ? OR content LIKE ?)
    ORDER BY confidence DESC, learned_at DESC
    LIMIT ?
  `).all(params.scope, params.domain, like, like, limit) as Record<string, unknown>[];

  return rows.map(rowToDoc);
}

/** Check if a document with this URL already exists (for deduplication). */
export function documentExistsByUrl(sourceUrl: string): boolean {
  const db     = getKnowledgeDb();
  const result = db.prepare(
    'SELECT COUNT(*) as count FROM knowledge_documents WHERE source_url = ?'
  ).get(sourceUrl) as { count: number };
  return result.count > 0;
}

// ── Serialisation helper ──────────────────────────────────────────────────────

function rowToDoc(row: Record<string, unknown>): KnowledgeDocument {
  return {
    id:         row['id']          as string,
    scope:      row['scope']       as string,
    domain:     row['domain']      as string,
    topic:      row['topic']       as string,
    sourceUrl:  row['source_url']  as string,
    sourceType: row['source_type'] as SourceType,
    title:      row['title']       as string,
    content:    row['content']     as string,
    keyPoints:  JSON.parse(row['key_points'] as string) as string[],
    confidence: row['confidence']  as number,
    learnedAt:  row['learned_at']  as string,
    createdAt:  row['created_at']  as string,
  };
}
