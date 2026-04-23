# Phase 8 — Knowledge Seed File Creation

**Instruction for Phase 8 implementation:** Create all 20 seed markdown files.

## File Listing

All files should be created at implementation time (not in this plan file) because their content is prose, not code. The plan file `06-knowledge-seeds.md` provides the full content of the payments domain files as reference.

For the remaining 15 files, follow the same 4-section structure:
1. Why it matters
2. How to implement (TypeScript code)
3. Key implementation details
4. References

### Security domain (5 files)

| File | Topic |
|---|---|
| `knowledge/security/01-secrets.md` | Environment variables vs hardcoded secrets, `.env` setup, secret scanning |
| `knowledge/security/02-auth.md` | JWT middleware patterns, Express auth middleware, role-based access |
| `knowledge/security/03-sql-injection.md` | Parameterized queries, ORM safe patterns, never interpolate user input |
| `knowledge/security/04-pii-logging.md` | What counts as PII, safe log fields (userId only), GDPR implications |
| `knowledge/security/05-input-validation.md` | Zod, Joi, express-validator patterns, validate at boundary |

### Reliability domain (5 files)

| File | Topic |
|---|---|
| `knowledge/reliability/01-timeouts.md` | axios timeout, `AbortController`, fetch timeout, what to set timeouts to |
| `knowledge/reliability/02-circuit-breaker.md` | opossum library, thresholds, half-open state, fallback strategies |
| `knowledge/reliability/03-promises.md` | Floating promise detection, `.catch()` vs `void`, unhandledRejection handler |
| `knowledge/reliability/04-retries.md` | p-retry, exponential backoff, terminal vs transient classification |
| `knowledge/reliability/05-n-plus-one.md` | DataLoader pattern, ORM `include`/`eager` loading, batch queries |

### Compliance domain (5 files)

| File | Topic |
|---|---|
| `knowledge/compliance/01-pii-logging.md` | What PII is, GDPR Article 5 data minimisation, safe logging patterns |
| `knowledge/compliance/02-pii-storage.md` | Encryption at rest, column transformers, hashing vs encryption |
| `knowledge/compliance/03-audit-trails.md` | Audit log schema, immutability, who-what-when-entity pattern |
| `knowledge/compliance/04-gdpr-delete.md` | Article 17, anonymisation vs deletion, cascade delete pattern |
| `knowledge/compliance/05-data-retention.md` | Retention periods by data type, TTL columns, scheduled cleanup jobs |

## Actual Seed File Locations (created at implementation, not in plans)

```
knowledge/
├── payments/
│   ├── 01-idempotency.md         ← content in 06-knowledge-seeds.md
│   ├── 02-webhook-security.md    ← content in 06-knowledge-seeds.md
│   ├── 03-error-handling.md      ← content in 06-knowledge-seeds.md
│   ├── 04-retries.md             ← content in 06-knowledge-seeds.md
│   └── 05-sdk-versions.md        ← content in 06-knowledge-seeds.md
├── security/
│   ├── 01-secrets.md
│   ├── 02-auth.md
│   ├── 03-sql-injection.md
│   ├── 04-pii-logging.md
│   └── 05-input-validation.md
├── reliability/
│   ├── 01-timeouts.md
│   ├── 02-circuit-breaker.md
│   ├── 03-promises.md
│   ├── 04-retries.md
│   └── 05-n-plus-one.md
└── compliance/
    ├── 01-pii-logging.md
    ├── 02-pii-storage.md
    ├── 03-audit-trails.md
    ├── 04-gdpr-delete.md
    └── 05-data-retention.md
```
