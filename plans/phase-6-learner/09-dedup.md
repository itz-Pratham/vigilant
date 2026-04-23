# Phase 6 — Knowledge Deduplication

**File:** `src/learner/dedup.ts`

## Objective

Prevent the same URL from being stored multiple times across learner runs. Dedup is URL-based (not content-based) for simplicity and speed.

---

## Implementation

```typescript
// src/learner/dedup.ts
import Database from 'better-sqlite3';

/**
 * Returns true if this URL has already been stored in the knowledge base.
 */
export function isKnownUrl(db: Database.Database, url: string): boolean {
  const row = db.prepare(`SELECT 1 FROM learned_urls WHERE url = ?`).get(url);
  return !!row;
}

/**
 * Returns all learned URLs for a domain (for debugging / vigilant learn --list).
 */
export function getLearnedUrls(
  db:     Database.Database,
  domain: string,
): Array<{ url: string; addedAt: number }> {
  return db.prepare(
    `SELECT url, added_at as addedAt FROM learned_urls WHERE domain = ? ORDER BY added_at DESC`
  ).all(domain) as Array<{ url: string; addedAt: number }>;
}

/**
 * Removes a URL from the dedup table (allows re-learning).
 * Used by: vigilant learn --force-url <url>
 */
export function forgetUrl(db: Database.Database, url: string): void {
  db.prepare(`DELETE FROM learned_urls WHERE url = ?`).run(url);
}

/**
 * Returns total count of learned documents per domain.
 * Used by: vigilant status --knowledge
 */
export function getKnowledgeStats(
  db: Database.Database,
): Array<{ domain: string; count: number }> {
  return db.prepare(
    `SELECT domain, COUNT(*) as count FROM learned_urls GROUP BY domain`
  ).all() as Array<{ domain: string; count: number }>;
}
```

---

## Schema Reference

```sql
CREATE TABLE IF NOT EXISTS learned_urls (
  url        TEXT PRIMARY KEY,
  domain     TEXT NOT NULL,
  added_at   INTEGER NOT NULL   -- unix timestamp ms
);
```

---

## Dedup Guarantee

The `url` column is `PRIMARY KEY` — SQLite enforces uniqueness at the database level. `addKnowledgeDocument()` (in `ragStore.ts`) checks with `SELECT 1` before calling NeuroLink, so no unnecessary embedding calls are made.

---

## `vigilant learn --list` Output (future v2)

```
Knowledge base stats:
  payments:    12 documents
  security:     8 documents
  reliability:  5 documents
  compliance:   3 documents

Most recently added:
  [2024-01-15] Stripe idempotency patterns — stripe.com/blog
  [2024-01-14] JWT best practices — owasp.org
  [2024-01-13] Circuit breaker in Node.js — engineering.uber.com
```
