# Phase 6 — Topic Queue

**File:** `src/learner/topicQueue.ts`

## Objective

Round-robin topic selection from `learning_topics` table. Each call picks the topic least recently run, runs the research, then updates `last_run_at` and `run_count`.

---

## Implementation

```typescript
// src/learner/topicQueue.ts
import Database from 'better-sqlite3';
import { LearningTopic, SourceType } from './types.js';

/**
 * Returns the next topic to research — least recently run first.
 * If all topics have run today, returns null (no learning needed this tick).
 */
export function getNextTopic(db: Database.Database): LearningTopic | null {
  const row = db.prepare(`
    SELECT * FROM learning_topics
    ORDER BY COALESCE(last_run_at, 0) ASC
    LIMIT 1
  `).get() as LearningTopic | undefined;

  return row ?? null;
}

/** Mark topic as completed for this run. */
export function markTopicRun(db: Database.Database, id: number): void {
  db.prepare(`
    UPDATE learning_topics
    SET last_run_at = ?, run_count = run_count + 1
    WHERE id = ?
  `).run(Date.now(), id);
}

/** Seed initial topics for each domain (idempotent — checks before inserting). */
export function seedTopics(db: Database.Database): void {
  const exists = db.prepare(`SELECT COUNT(*) as c FROM learning_topics`).get() as { c: number };
  if (exists.c > 0) return; // already seeded

  const topics: Array<{ domain: string; topic: string; sourceType: SourceType }> = [
    // payments
    { domain: 'payments', topic: 'idempotency keys in payment APIs',          sourceType: 'github_prs' },
    { domain: 'payments', topic: 'webhook HMAC signature verification',        sourceType: 'github_prs' },
    { domain: 'payments', topic: 'payment SDK upgrade guides',                 sourceType: 'engineering_blog' },
    { domain: 'payments', topic: 'stripe idempotency CVE',                     sourceType: 'cve_database' },
    // security
    { domain: 'security', topic: 'JWT best practices 2024',                    sourceType: 'github_prs' },
    { domain: 'security', topic: 'SQL injection prevention TypeScript',        sourceType: 'github_prs' },
    { domain: 'security', topic: 'OWASP top 10 nodejs',                        sourceType: 'engineering_blog' },
    { domain: 'security', topic: 'secret scanning github best practices',      sourceType: 'github_advisories' },
    // reliability
    { domain: 'reliability', topic: 'circuit breaker pattern nodejs',          sourceType: 'github_prs' },
    { domain: 'reliability', topic: 'timeout configuration best practices',    sourceType: 'engineering_blog' },
    { domain: 'reliability', topic: 'retry with exponential backoff',          sourceType: 'github_prs' },
    { domain: 'reliability', topic: 'promise error handling patterns',         sourceType: 'github_prs' },
    // compliance
    { domain: 'compliance', topic: 'GDPR right to erasure implementation',     sourceType: 'engineering_blog' },
    { domain: 'compliance', topic: 'PII encryption at rest nodejs',            sourceType: 'github_prs' },
    { domain: 'compliance', topic: 'audit log design patterns',                sourceType: 'github_prs' },
    { domain: 'compliance', topic: 'data retention policy implementation',     sourceType: 'engineering_blog' },
  ];

  const insert = db.prepare(`
    INSERT INTO learning_topics (domain, topic, source_type, run_count)
    VALUES (@domain, @topic, @sourceType, 0)
  `);

  const insertMany = db.transaction((rows: typeof topics) => {
    for (const row of rows) insert.run(row);
  });

  insertMany(topics);
}
```

---

## Round-Robin Guarantee

`ORDER BY COALESCE(last_run_at, 0) ASC` ensures:
- Never-run topics go first (last_run_at = 0)
- After that, oldest-run topic always next
- No topic is skipped indefinitely
