// src/learner/topicQueue.ts
// Round-robin topic selection from the learning_topics table.

import Database        from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { LearnerSourceType, LearningTopic } from './types.js';

type TopicRow = {
  id:                string;
  domain:            string;
  topic:             string;
  source_type:       string;
  last_researched_at: string | null;
  research_count:    number;
};

const SEED_TOPICS: Array<{ domain: string; topic: string; sourceType: LearnerSourceType }> = [
  // payments
  { domain: 'payments', topic: 'idempotency keys in payment APIs',     sourceType: 'github_prs' },
  { domain: 'payments', topic: 'webhook HMAC signature verification',  sourceType: 'github_prs' },
  { domain: 'payments', topic: 'payment SDK retry best practices',     sourceType: 'engineering_blog' },
  { domain: 'payments', topic: 'stripe payment CVE vulnerabilities',   sourceType: 'cve_database' },
  // security
  { domain: 'security', topic: 'JWT token security best practices',    sourceType: 'github_prs' },
  { domain: 'security', topic: 'SQL injection prevention TypeScript',  sourceType: 'github_prs' },
  { domain: 'security', topic: 'OWASP top 10 nodejs security',         sourceType: 'engineering_blog' },
  { domain: 'security', topic: 'npm package security advisories',      sourceType: 'github_advisories' },
  // reliability
  { domain: 'reliability', topic: 'circuit breaker pattern nodejs',    sourceType: 'github_prs' },
  { domain: 'reliability', topic: 'timeout configuration best practices', sourceType: 'engineering_blog' },
  { domain: 'reliability', topic: 'retry exponential backoff nodejs',  sourceType: 'github_prs' },
  { domain: 'reliability', topic: 'unhandled promise rejection patterns', sourceType: 'github_prs' },
  // compliance
  { domain: 'compliance', topic: 'GDPR right to erasure implementation', sourceType: 'engineering_blog' },
  { domain: 'compliance', topic: 'PII encryption at rest nodejs',      sourceType: 'github_prs' },
  { domain: 'compliance', topic: 'audit log design patterns',          sourceType: 'github_prs' },
  { domain: 'compliance', topic: 'data retention policy implementation', sourceType: 'engineering_blog' },
];

/**
 * Seeds initial learning topics if the table is empty. Idempotent.
 */
export function seedTopics(db: Database.Database): void {
  const { c } = db.prepare<[], { c: number }>('SELECT COUNT(*) as c FROM learning_topics').get()!;
  if (c > 0) return;

  const insert = db.prepare(`
    INSERT INTO learning_topics (id, domain, topic, search_query, source_type, research_count)
    VALUES (@id, @domain, @topic, @topic, @sourceType, 0)
  `);

  const insertAll = db.transaction((rows: typeof SEED_TOPICS) => {
    for (const row of rows) {
      insert.run({ id: randomUUID(), ...row });
    }
  });

  insertAll(SEED_TOPICS);
}

/**
 * Returns the topic least recently researched (round-robin).
 * Optionally filters by domain.
 * Returns null if the table is empty.
 */
export function getNextTopic(db: Database.Database, domain?: string): LearningTopic | null {
  let row: TopicRow | undefined;

  if (domain) {
    row = db.prepare<[string], TopicRow>(`
      SELECT id, domain, topic, source_type, last_researched_at, research_count
      FROM learning_topics
      WHERE domain = ?
      ORDER BY COALESCE(last_researched_at, '0') ASC
      LIMIT 1
    `).get(domain);
  } else {
    row = db.prepare<[], TopicRow>(`
      SELECT id, domain, topic, source_type, last_researched_at, research_count
      FROM learning_topics
      ORDER BY COALESCE(last_researched_at, '0') ASC
      LIMIT 1
    `).get();
  }

  if (!row) return null;

  return {
    id:               row.id,
    domain:           row.domain,
    topic:            row.topic,
    sourceType:       row.source_type as LearnerSourceType,
    lastResearchedAt: row.last_researched_at,
    researchCount:    row.research_count,
  };
}

/**
 * Marks a topic as researched right now, incrementing its run count.
 * Call this BEFORE the network request to prevent concurrent learner runs
 * from picking the same topic.
 */
export function claimTopic(db: Database.Database, id: string): void {
  db.prepare(`
    UPDATE learning_topics
    SET last_researched_at = ?, research_count = research_count + 1
    WHERE id = ?
  `).run(new Date().toISOString(), id);
}
