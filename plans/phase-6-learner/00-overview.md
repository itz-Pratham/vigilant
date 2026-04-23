# Phase 6 — Learner

## Goal

When the watcher finds no new issues across `LEARNER_IDLE_TICKS_TRIGGER` consecutive ticks, run one background research job. Fetch best-practice content from GitHub and the web, summarise it, and store it in the RAG knowledge base. The next investigation session benefits from richer context without any human action.

## In Scope

- `learning_topics` SQLite table — round-robin topic queue per domain
- `GitHubResearcher` — merged PRs and security advisories via GitHub Search
- `WebResearcher` — NeuroLink AutoResearch (follows links, depth 2, synthesises)
- `RAGStore` wrapper — idempotent `addKnowledgeDocument` with URL deduplication
- `vigilant learn [--topic <topic>]` CLI command — manual one-off research
- Idle trigger: called by the watcher when `idleTickCount >= LEARNER_IDLE_TICKS_TRIGGER`

## Out of Scope

- Scheduled/cron-based learning (watcher idle tick is the only trigger)
- Storing raw HTML — only summarised markdown is persisted
- Any learning that sends the user's code to a third party

## File Structure Created

```
src/
└── learner/
    ├── index.ts          ← runLearner(packs, config) — entry point
    ├── types.ts          ← LearningTopic, ResearchResult
    ├── topicQueue.ts     ← SQLite round-robin topic queue
    ├── githubResearcher.ts ← GitHub API research
    ├── webResearcher.ts  ← NeuroLink AutoResearch wrapper
    └── ragStore.ts       ← addKnowledgeDocument with dedup
```

## Research Sources (Round-Robin Priority)

1. GitHub merged PRs matching `{domain} best practice fix language:TypeScript`
2. GitHub Security Advisories for domain-relevant packages (`npm:stripe`, `npm:jsonwebtoken`)
3. Engineering blogs: Stripe, Razorpay, Juspay, Netflix, Uber, Cloudflare (via AutoResearch)
4. CVE database entries for payment/security packages
5. GitHub trending repos tagged with domain keywords

## Topic Seeding Per Domain

On first `vigilant start`, the `learning_topics` table is seeded with initial topics:

| Domain | Seed topics |
|---|---|
| payments | idempotency keys, webhook signature verification, payment retries, SDK upgrade guides |
| security | JWT best practices, SQL injection prevention, OWASP top 10, secret scanning |
| reliability | circuit breaker patterns, timeout configuration, retry with backoff, health checks |
| compliance | GDPR data deletion, PII encryption, audit logging patterns, data retention |

## Success Criteria

- After `LEARNER_IDLE_TICKS_TRIGGER` idle ticks, `runLearner()` is called once
- Each call processes one topic from the queue and rotates it to the back
- New documents appear in `knowledge_documents` with `scope = 'global'`
- Re-running the learner on the same URL does not create duplicate documents
- `vigilant learn --topic "idempotency keys"` triggers a one-off research job
- Learning jobs do not block the watcher tick loop (fire-and-forget)
