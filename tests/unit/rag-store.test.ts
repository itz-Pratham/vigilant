// tests/unit/rag-store.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { storeResearchResults }              from '../../src/learner/ragStore.js';
import { resetDbForTesting, getKnowledgeDb } from '../../src/db/index.js';
import type { ResearchDocument }             from '../../src/learner/types.js';

function makeDoc(overrides: Partial<ResearchDocument> = {}): ResearchDocument {
  return {
    title:      'Test document',
    url:        `https://example.com/article-${Math.random()}`,
    content:    '# Best Practice\n\nAlways add an idempotency key.',
    domain:     'payments',
    sourceType: 'github_prs',
    tags:       ['payments', 'idempotency'],
    ...overrides,
  };
}

beforeEach(() => {
  process.env['VIGILANT_KNOWLEDGE_DB_PATH'] = ':memory:';
  resetDbForTesting();
});

describe('storeResearchResults', () => {
  it('stores a single new document and returns count 1', () => {
    const doc    = makeDoc();
    const added  = storeResearchResults([doc], 'global', 'idempotency keys');
    expect(added).toBe(1);
  });

  it('stores multiple documents and returns correct count', () => {
    const docs  = [makeDoc(), makeDoc(), makeDoc()];
    const added = storeResearchResults(docs, 'global', 'idempotency keys');
    expect(added).toBe(3);
  });

  it('skips a document with a duplicate URL (dedup)', () => {
    const url = 'https://example.com/stable-url';
    storeResearchResults([makeDoc({ url })], 'global', 'idempotency');
    const added = storeResearchResults([makeDoc({ url })], 'global', 'idempotency');
    expect(added).toBe(0);
  });

  it('partially stores a batch where some URLs are new and some are duplicates', () => {
    const existing = makeDoc({ url: 'https://example.com/exists' });
    storeResearchResults([existing], 'global', 'idempotency');

    const mixed = [
      makeDoc({ url: 'https://example.com/exists' }), // duplicate
      makeDoc({ url: 'https://example.com/new1' }),    // new
      makeDoc({ url: 'https://example.com/new2' }),    // new
    ];
    const added = storeResearchResults(mixed, 'global', 'idempotency');
    expect(added).toBe(2);
  });

  it('stores docs with repo scope correctly', () => {
    const doc   = makeDoc({ url: 'https://example.com/scoped' });
    const added = storeResearchResults([doc], 'repo:myorg/myrepo', 'idempotency');
    expect(added).toBe(1);

    const db  = getKnowledgeDb();
    const row = db.prepare<[string], { scope: string }>('SELECT scope FROM knowledge_documents WHERE source_url = ?').get(doc.url)!;
    expect(row.scope).toBe('repo:myorg/myrepo');
  });

  it('maps github_prs source type to github_repo in knowledge_documents', () => {
    const doc = makeDoc({ sourceType: 'github_prs', url: 'https://example.com/pr-doc' });
    storeResearchResults([doc], 'global', 'idempotency');
    const db  = getKnowledgeDb();
    const row = db.prepare<[string], { source_type: string }>('SELECT source_type FROM knowledge_documents WHERE source_url = ?').get(doc.url)!;
    expect(row.source_type).toBe('github_repo');
  });

  it('maps engineering_blog source type to web in knowledge_documents', () => {
    const doc = makeDoc({ sourceType: 'engineering_blog', url: 'https://example.com/blog-doc' });
    storeResearchResults([doc], 'global', 'best practices');
    const db  = getKnowledgeDb();
    const row = db.prepare<[string], { source_type: string }>('SELECT source_type FROM knowledge_documents WHERE source_url = ?').get(doc.url)!;
    expect(row.source_type).toBe('web');
  });

  it('returns 0 for an empty docs array', () => {
    expect(storeResearchResults([], 'global', 'idempotency')).toBe(0);
  });
});
