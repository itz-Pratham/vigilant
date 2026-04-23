# Phase 8 — Domain Packs

## Goal

Implement all four v1 domain packs — payments, security, reliability, and compliance — with complete `PatternRule[]` arrays, `FixStrategy[]` arrays with before/after examples, CI keywords, and file path patterns. Also seed all 20 knowledge files (5 per domain) that bootstrap the RAG knowledge base.

## In Scope

- Full implementation of `payments`, `security`, `reliability`, and `compliance` `DomainPack` objects
- `PatternRule` entries for all 22 issue types (7+5+5+5)
- `FixStrategy` entries with `badExample` and `goodExample` for all 22 issue types
- Knowledge seed markdown files: `knowledge/{domain}/` — 5 files per domain
- Domain pack registry: `src/agent/domain-context.ts` pack array (Phase 3 shell → Phase 8 implementation)
- `--domain` flag on `vigilant start` to restrict to one domain

## Out of Scope

- v2 domain packs (performance, accessibility, testing, infrastructure)
- Custom domain pack registry (`vigilant pack install`)
- Domain pack hot-reload (requires daemon restart to pick up new packs)

## File Structure Created

```
src/
└── packs/
    ├── payments.ts       ← payments DomainPack object
    ├── security.ts       ← security DomainPack object
    ├── reliability.ts    ← reliability DomainPack object
    └── compliance.ts     ← compliance DomainPack object

knowledge/
├── payments/
│   ├── 01-idempotency.md
│   ├── 02-webhook-security.md
│   ├── 03-error-handling.md
│   ├── 04-retries.md
│   └── 05-sdk-versions.md
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

## Domain Pack Summary

| Domain | Issues | Pattern searches | File patterns |
|---|---|---|---|
| payments | 7 | GitHub code search (TypeScript/JS) | `*payment*`, `*charge*`, `*checkout*`, `*webhook*` |
| security | 5 | Regex + GitHub code search | `*.ts`, `*.js`, `*.env*`, `*config*` |
| reliability | 5 | GitHub code search (TypeScript/JS) | `*.ts`, `*.js`, `*service*`, `*client*` |
| compliance | 5 | GitHub code search | `*.ts`, `*.js`, `*model*`, `*entity*`, `*schema*` |

## Success Criteria

- `loadActiveDomainPacks(config)` returns correct pack(s) based on config `domains` array
- Each pack's `patternRules` produce valid GitHub code search queries
- Knowledge seed files load into RAG without error on `vigilant start`
- Agent investigation uses domain-specific pattern and fix strategy context
- `vigilant start --domain security` watches only security patterns
