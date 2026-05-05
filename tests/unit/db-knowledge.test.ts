// tests/unit/db-knowledge.test.ts
// Unit tests for src/db/queries/knowledge.ts using in-memory SQLite.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDbForTesting } from '../../src/db/index.js';
import {
  addKnowledgeDocument,
  searchDocuments,
  documentExistsByUrl,
} from '../../src/db/queries/knowledge.js';
import type { KnowledgeDocument } from '../../src/db/queries/knowledge.js';

function makeDoc(overrides: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  const now = new Date().toISOString();
  return {
    id:         overrides.id         ?? `doc_${Math.random().toString(36).slice(2)}`,
    scope:      overrides.scope      ?? 'global',
    domain:     overrides.domain     ?? 'payments',
    topic:      overrides.topic      ?? 'idempotency',
    sourceUrl:  overrides.sourceUrl  ?? `https://example.com/${Math.random()}`,
    sourceType: overrides.sourceType ?? 'web',
    title:      overrides.title      ?? 'Idempotency Keys Guide',
    content:    overrides.content    ?? 'Always use idempotency keys for payment calls.',
    keyPoints:  overrides.keyPoints  ?? ['use idempotency keys'],
    confidence: overrides.confidence ?? 1.0,
    learnedAt:  now,
    createdAt:  now,
    ...overrides,
  };
}

beforeEach(() => {
  process.env['VIGILANT_KNOWLEDGE_DB_PATH'] = ':memory:';
  resetDbForTesting();
});

afterEach(() => {
  resetDbForTesting();
  delete process.env['VIGILANT_KNOWLEDGE_DB_PATH'];
});

describe('addKnowledgeDocument', () => {
  it('returns true when inserting a new document', () => {
    const doc = makeDoc();
    expect(addKnowledgeDocument(doc)).toBe(true);
  });

  it('returns false when inserting a duplicate URL', () => {
    const url = 'https://example.com/idempotency';
    const doc = makeDoc({ sourceUrl: url });
    addKnowledgeDocument(doc);
    const dup = makeDoc({ id: 'dup_001', sourceUrl: url });
    expect(addKnowledgeDocument(dup)).toBe(false);
  });

  it('persists keyPoints as array', () => {
    const doc = makeDoc({ scope: 'global', domain: 'payments', keyPoints: ['point A', 'point B'] });
    addKnowledgeDocument(doc);
    const results = searchDocuments({ scope: 'global', domain: 'payments', query: doc.title });
    expect(results[0].keyPoints).toEqual(['point A', 'point B']);
  });
});

describe('searchDocuments', () => {
  it('finds a document by title keyword', () => {
    addKnowledgeDocument(makeDoc({ title: 'Stripe Retry Logic', scope: 'global', domain: 'payments' }));
    const results = searchDocuments({ scope: 'global', domain: 'payments', query: 'Stripe' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toContain('Stripe');
  });

  it('finds a document by content keyword', () => {
    addKnowledgeDocument(makeDoc({ content: 'webhook signature validation is critical', scope: 'global', domain: 'payments' }));
    const results = searchDocuments({ scope: 'global', domain: 'payments', query: 'signature validation' });
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns empty array when no match found', () => {
    const results = searchDocuments({ scope: 'global', domain: 'payments', query: 'NONEXISTENT_TERM_XYZ' });
    expect(results).toHaveLength(0);
  });

  it('respects scope boundary — does not return docs from other scopes', () => {
    addKnowledgeDocument(makeDoc({ scope: 'repo:acme/api', domain: 'payments', title: 'Scoped doc' }));
    const results = searchDocuments({ scope: 'global', domain: 'payments', query: 'Scoped doc' });
    expect(results).toHaveLength(0);
  });

  it('respects domain boundary', () => {
    addKnowledgeDocument(makeDoc({ scope: 'global', domain: 'security', title: 'Security Guide' }));
    const results = searchDocuments({ scope: 'global', domain: 'payments', query: 'Security Guide' });
    expect(results).toHaveLength(0);
  });

  it('respects limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      addKnowledgeDocument(makeDoc({ title: `Guide ${i}`, scope: 'global', domain: 'payments' }));
    }
    const results = searchDocuments({ scope: 'global', domain: 'payments', query: 'Guide', limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

describe('documentExistsByUrl', () => {
  it('returns false for a URL that has never been added', () => {
    expect(documentExistsByUrl('https://example.com/never')).toBe(false);
  });

  it('returns true after inserting a document with that URL', () => {
    const url = 'https://example.com/exists';
    addKnowledgeDocument(makeDoc({ sourceUrl: url }));
    expect(documentExistsByUrl(url)).toBe(true);
  });
});
