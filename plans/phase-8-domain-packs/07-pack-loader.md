# Phase 8 — Pack Loader

**File:** `src/agent/domain-context.ts` (registry + loader) + `src/commands/start.ts` integration

## Objective

Show exactly how packs are loaded at startup, how the `--domain` flag overrides config, and how the watcher uses pack pattern rules to build GitHub search queries.

---

## Implementation

```typescript
// src/agent/domain-context.ts — additions beyond 01-interface.md

/**
 * Resolves the active domain packs from config, with optional CLI override.
 * @param config       - loaded vigilant config
 * @param domainFlag   - value of --domain CLI flag, if provided
 */
export function resolveActivePacks(
  config:      VigilantConfig,
  domainFlag?: string,
): DomainPack[] {
  const enabled = domainFlag
    ? [domainFlag]
    : (config.domains ?? ['payments']);

  return enabled.map(id => {
    const pack = PACK_REGISTRY[id];
    if (!pack) {
      throw new Error(
        `Unknown domain: "${id}". Valid options: ${Object.keys(PACK_REGISTRY).join(', ')}`
      );
    }
    return pack;
  });
}

/**
 * Builds the GitHub code search query for a pattern rule.
 * Replaces {owner} and {repo} placeholders.
 */
export function buildSearchQuery(
  rule:  PatternRule,
  owner: string,
  repo:  string,
): string {
  return rule.searchQuery
    .replace('{owner}', owner)
    .replace('{repo}',  repo);
}

/**
 * Returns all pattern rules across active packs that have non-empty searchQuery.
 * Rules with empty searchQuery are CI/dependency scanner only (no code search).
 */
export function getCodeSearchRules(packs: DomainPack[]): PatternRule[] {
  return packs.flatMap(p => p.patternRules).filter(r => r.searchQuery !== '');
}

/**
 * Returns all CI keywords across active packs for CI failure detection.
 */
export function getCIKeywords(packs: DomainPack[]): string[] {
  return [...new Set(
    packs.flatMap(p => p.patternRules.flatMap(r => r.ciKeywords ?? []))
  )];
}
```

---

## Startup Integration (`src/commands/start.ts`)

```typescript
import { resolveActivePacks } from '../agent/domain-context.js';
import { loadDomainSeeds }    from '../agent/domain-context.js';

// After config load, before watcher:
const activePacks = resolveActivePacks(config, opts.domain);

// Seed knowledge base once per pack (idempotent)
for (const pack of activePacks) {
  await loadDomainSeeds(pack, neurolink, db);
}

// Pass packs into watcher
await startWatcher(repoSlug, activePacks, config, db, kdb, octokit, neurolink);
```

---

## --domain Flag in start Command

```typescript
// src/commands/start.ts
export const startCommand = new Command('start')
  .option('--domain <domain>', 'Override configured domain(s) with a single domain')
  // ...
  .action(async (opts) => {
    const activePacks = resolveActivePacks(config, opts.domain);
    // ...
  });
```

---

## Watcher Usage

In `src/watcher/pattern-scanner.ts` (Phase 2):

```typescript
import { buildSearchQuery, getCodeSearchRules } from '../agent/domain-context.js';

const rules = getCodeSearchRules(activePacks);

for (const rule of rules) {
  const query = buildSearchQuery(rule, config.owner, config.repo);
  const results = await octokit.search.code({ q: query, per_page: 10 });
  // ... map results to DetectedIssue
}
```

---

## Pack Registry Table

| ID | Class | Issues | searchQuery rules | CI rules |
|---|---|---|---|---|
| `payments` | `payments` | 7 | 5 | 1 (CI_PAYMENT_FAILURE) |
| `security` | `security` | 5 | 5 | 0 |
| `reliability` | `reliability` | 5 | 5 | 0 |
| `compliance` | `compliance` | 5 | 5 | 0 |
