# Phase 8 — Integration

**File:** Wiring all four domain packs into the full system.

## Objective

Show the complete data flow from pack registration through watcher detection, agent prompt building, executor fix writing, and MCP pattern lookup.

---

## End-to-End Data Flow

```
vigilant start --domain security
        │
        ▼
resolveActivePacks(['security'])  → returns [security DomainPack]
        │
        ▼
loadDomainSeeds(security, neurolink, db)
  → reads knowledge/security/*.md
  → neurolink.addDocument() × 5 files (if not already in learned_urls)
        │
        ▼
startWatcher(repoSlug, [security], config, db, kdb, octokit, neurolink)
        │
        ├── patternScanner: getCodeSearchRules([security])
        │     → 5 rules, each with searchQuery
        │     → buildSearchQuery(rule, 'acme', 'backend')
        │     → octokit.search.code({ q: '...' })
        │     → DetectedIssue: { issueType: 'SQL_INJECTION_RISK', severity: 'CRITICAL', ... }
        │
        ▼
runAgentLoop(session)
  → buildDomainPromptBlock(security, 'SQL_INJECTION_RISK')
  → injects bad/good example into investigation system prompt
  → agent uses ragSearch({ query: 'SQL injection TypeScript', scope: 'global' })
    → returns knowledge/security/03-sql-injection.md content
  → agent builds Plan
        │
        ▼
Gate 1 → awaiting_approval → (human approves) → executing
        │
        ▼
runExecutor(session)
  → findPackForIssueType([security], 'SQL_INJECTION_RISK')
  → strategy.badExample used for context trimming
  → strategy.goodExample used as few-shot example in CodeWriter prompt
        │
        ▼
PR opened with fix
        │
        ▼
vigilant serve
  → get_domain_pattern('SQL_INJECTION_RISK')
    → findPackForIssueType → returns strategy with bad/good examples
  → analyze_snippet('SELECT * FROM users WHERE id = ${req.body.id}')
    → builds domain context from all 5 security fixStrategies
    → NeuroLink classifies as SQL_INJECTION_RISK, confidence: 0.95
```

---

## New Files Added This Phase

```
src/
└── packs/
    ├── payments.ts
    ├── security.ts
    ├── reliability.ts
    └── compliance.ts

knowledge/
├── payments/   (5 .md seed files)
├── security/   (5 .md seed files)
├── reliability/ (5 .md seed files)
└── compliance/  (5 .md seed files)
```

---

## Changes to Existing Files

| File | Change |
|---|---|
| `src/agent/domain-context.ts` | Import all 4 packs; populate `PACK_REGISTRY`; add `resolveActivePacks`, `buildSearchQuery`, `getCodeSearchRules`, `getCIKeywords` |
| `src/commands/start.ts` | Accept `--domain` flag; call `resolveActivePacks`; call `loadDomainSeeds` per pack |
| `src/executor/code-writer.ts` | Pass `FixStrategy` to `FIX_PROMPT`; call `trimAroundBadPattern` for large files |

---

## No New Dependencies

Phase 8 introduces zero new npm packages. All domain pack code is pure TypeScript using existing imports.
