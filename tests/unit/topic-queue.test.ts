// tests/unit/topic-queue.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { seedTopics, getNextTopic, claimTopic } from '../../src/learner/topicQueue.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS learning_topics (
      id                 TEXT PRIMARY KEY,
      domain             TEXT NOT NULL,
      topic              TEXT NOT NULL,
      search_query       TEXT NOT NULL,
      source_type        TEXT NOT NULL DEFAULT 'github_prs',
      last_researched_at TEXT,
      research_count     INTEGER NOT NULL DEFAULT 0
    )
  `);
  return db;
}

describe('seedTopics', () => {
  it('seeds 16 topics on an empty DB', () => {
    const db = makeDb();
    seedTopics(db);
    const { c } = db.prepare<[], { c: number }>('SELECT COUNT(*) as c FROM learning_topics').get()!;
    expect(c).toBe(16);
  });

  it('is idempotent — second call does not add more rows', () => {
    const db = makeDb();
    seedTopics(db);
    seedTopics(db);
    const { c } = db.prepare<[], { c: number }>('SELECT COUNT(*) as c FROM learning_topics').get()!;
    expect(c).toBe(16);
  });

  it('seeds topics across all 4 domains', () => {
    const db = makeDb();
    seedTopics(db);
    const domains = db.prepare<[], { domain: string }>('SELECT DISTINCT domain FROM learning_topics').all().map(r => r.domain);
    expect(domains).toContain('payments');
    expect(domains).toContain('security');
    expect(domains).toContain('reliability');
    expect(domains).toContain('compliance');
  });
});

describe('getNextTopic', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
    seedTopics(db);
  });

  it('returns a topic from an empty last_researched_at first', () => {
    const topic = getNextTopic(db);
    expect(topic).not.toBeNull();
    expect(topic!.lastResearchedAt).toBeNull();
  });

  it('filters by domain when specified', () => {
    const topic = getNextTopic(db, 'security');
    expect(topic).not.toBeNull();
    expect(topic!.domain).toBe('security');
  });

  it('returns null on empty table', () => {
    const emptyDb = makeDb();
    expect(getNextTopic(emptyDb)).toBeNull();
  });

  it('implements round-robin: next call returns a different topic after claim', () => {
    const first = getNextTopic(db)!;
    claimTopic(db, first.id);
    const second = getNextTopic(db)!;
    // The second topic must have an older (or null) last_researched_at than first
    expect(second.id).not.toBe(first.id);
  });
});

describe('claimTopic', () => {
  it('updates last_researched_at and increments research_count', () => {
    const db = makeDb();
    seedTopics(db);
    const topic = getNextTopic(db)!;
    expect(topic.researchCount).toBe(0);
    claimTopic(db, topic.id);
    const updated = getNextTopic(db, topic.domain === 'payments' ? 'security' : 'payments'); // pick different domain to avoid same topic
    // check the claimed topic directly
    const row = db.prepare<[string], { research_count: number; last_researched_at: string }>('SELECT research_count, last_researched_at FROM learning_topics WHERE id = ?').get(topic.id)!;
    expect(row.research_count).toBe(1);
    expect(row.last_researched_at).toBeTruthy();
    void updated;
  });

  it('claimed topic moves to back of round-robin queue', () => {
    const db = makeDb();
    seedTopics(db);
    const first = getNextTopic(db)!;
    claimTopic(db, first.id);
    // Now the first topic should not be next
    const next = getNextTopic(db)!;
    expect(next.id).not.toBe(first.id);
  });
});
