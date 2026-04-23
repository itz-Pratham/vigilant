# Phase 8 — Implementation Checklist

## Interface (`01-interface.md`)
- [ ] `PatternRule` interface: `{ issueType, label, severity, searchQuery, filePatterns, ciKeywords? }`
- [ ] `FixStrategy` interface: `{ issueType, severity, description, badExample, goodExample, searchQuery?, contextLinesBefore?, contextLinesAfter? }`
- [ ] `DomainPack` interface: `{ id, name, version, patternRules, fixStrategies, knowledgeSeedDir, ciDetectedTypes }`
- [ ] `PACK_REGISTRY` object populated with all 4 packs
- [ ] `loadActiveDomainPacks(config)` — maps `config.domains` to pack objects
- [ ] `findPackForIssueType(packs, issueType)` — returns `{ pack, strategy }`
- [ ] `buildDomainPromptBlock(pack, issueType)` — markdown block with description + bad/good examples
- [ ] `loadDomainSeeds(pack, neurolink, db)` — reads `knowledgeSeedDir/*.md`, adds each to RAG with dedup; metadata includes `source_type: 'codebase'`
- [ ] `resolveActivePacks(config, domainFlag?)` — resolves packs with CLI override support
- [ ] `buildSearchQuery(rule, owner, repo)` — replaces `{owner}` and `{repo}` placeholders
- [ ] `getCodeSearchRules(packs)` — returns all rules with non-empty `searchQuery`
- [ ] `getCIKeywords(packs)` — deduped list of CI keywords across all active packs

## Payments Pack (`02-payments-pack.md`)
- [ ] Create `src/packs/payments.ts`
- [ ] 7 `patternRules`: MISSING_IDEMPOTENCY, WEBHOOK_NO_SIGNATURE, SILENT_ERROR_SWALLOW, RETRY_ON_TERMINAL_ERROR, SDK_VERSION_DRIFT, CI_PAYMENT_FAILURE, MISSING_TIMEOUT
- [ ] SDK_VERSION_DRIFT rule: empty searchQuery (dependency scanner only, not code search)
- [ ] CI_PAYMENT_FAILURE rule: empty searchQuery + CI keywords array
- [ ] 7 `fixStrategies` with complete `badExample` and `goodExample` TypeScript snippets
- [ ] `knowledgeSeedDir`: points to `knowledge/payments/`
- [ ] `ciDetectedTypes`: `['CI_PAYMENT_FAILURE']`

## Security Pack (`03-security-pack.md`)
- [ ] Create `src/packs/security.ts`
- [ ] 5 `patternRules`: SECRET_IN_CODE, MISSING_AUTH_CHECK, SQL_INJECTION_RISK, PII_IN_LOGS, UNVALIDATED_INPUT
- [ ] All 5 rules have non-empty `searchQuery`
- [ ] 5 `fixStrategies` with complete `badExample` and `goodExample`
- [ ] `knowledgeSeedDir`: points to `knowledge/security/`
- [ ] `ciDetectedTypes`: `[]`

## Reliability Pack (`04-reliability-pack.md`)
- [ ] Create `src/packs/reliability.ts`
- [ ] 5 `patternRules`: MISSING_TIMEOUT, NO_CIRCUIT_BREAKER, UNHANDLED_PROMISE, MISSING_RETRY_LOGIC, N_PLUS_ONE_QUERY
- [ ] All 5 rules have non-empty `searchQuery`
- [ ] 5 `fixStrategies` — N_PLUS_ONE_QUERY uses DataLoader/batch pattern
- [ ] `knowledgeSeedDir`: points to `knowledge/reliability/`

## Compliance Pack (`05-compliance-pack.md`)
- [ ] Create `src/packs/compliance.ts`
- [ ] 5 `patternRules`: PII_IN_LOGS, UNENCRYPTED_PII_STORAGE, MISSING_AUDIT_TRAIL, GDPR_RIGHT_TO_DELETE_GAP, MISSING_DATA_RETENTION_POLICY
- [ ] UNENCRYPTED_PII_STORAGE: severity = CRITICAL, targets schema/model files
- [ ] 5 `fixStrategies` — GDPR_RIGHT_TO_DELETE_GAP shows full anonymiseUser() function
- [ ] `knowledgeSeedDir`: points to `knowledge/compliance/`

## Knowledge Seeds (`06-knowledge-seeds.md`, `10-seed-files-list.md`)
- [ ] Create `knowledge/payments/01-idempotency.md`
- [ ] Create `knowledge/payments/02-webhook-security.md`
- [ ] Create `knowledge/payments/03-error-handling.md`
- [ ] Create `knowledge/payments/04-retries.md`
- [ ] Create `knowledge/payments/05-sdk-versions.md`
- [ ] Create `knowledge/security/01-secrets.md`
- [ ] Create `knowledge/security/02-auth.md`
- [ ] Create `knowledge/security/03-sql-injection.md`
- [ ] Create `knowledge/security/04-pii-logging.md`
- [ ] Create `knowledge/security/05-input-validation.md`
- [ ] Create `knowledge/reliability/01-timeouts.md`
- [ ] Create `knowledge/reliability/02-circuit-breaker.md`
- [ ] Create `knowledge/reliability/03-promises.md`
- [ ] Create `knowledge/reliability/04-retries.md`
- [ ] Create `knowledge/reliability/05-n-plus-one.md`
- [ ] Create `knowledge/compliance/01-pii-logging.md`
- [ ] Create `knowledge/compliance/02-pii-storage.md`
- [ ] Create `knowledge/compliance/03-audit-trails.md`
- [ ] Create `knowledge/compliance/04-gdpr-delete.md`
- [ ] Create `knowledge/compliance/05-data-retention.md`
- [ ] All 20 files follow 4-section structure: Why/How/Details/References

## Pack Loader (`07-pack-loader.md`)
- [ ] `resolveActivePacks` throws clear error for unknown domain ID
- [ ] `--domain` flag wired into `src/commands/start.ts`
- [ ] `loadDomainSeeds` called for each active pack at startup (before watcher loop)
- [ ] Seed loading is idempotent — `learned_urls` dedup prevents duplicate RAG entries

## Fix Strategy Detail (`08-fix-strategy-detail.md`)
- [ ] `CodeWriter` extended: `findPackForIssueType` to get strategy for current session
- [ ] `FIX_PROMPT` updated: includes `badExample` and `goodExample` as few-shot context
- [ ] `trimAroundBadPattern()` implemented: extracts keyword from `badExample`, finds matching line, trims ±30 lines
- [ ] Issue types requiring full file context documented and handled (no trimming)

## Integration (`09-integration.md`)
- [ ] Pack import chain: `domain-context.ts` → `src/packs/*.ts` → used in watcher, agent, executor, MCP
- [ ] `getCodeSearchRules` used in `pattern-scanner.ts` (Phase 2)
- [ ] `getCIKeywords` used in `ci-scanner.ts` (Phase 2)
- [ ] `buildDomainPromptBlock` used in agent investigation prompt (Phase 3)
- [ ] `findPackForIssueType` used in `code-writer.ts` (Phase 5) and MCP `get_domain_pattern` (Phase 7)
- [ ] Zero new npm dependencies in Phase 8

## Verification
- [ ] `vigilant start --domain payments` watches only payment pattern rules
- [ ] `vigilant start --domain security,reliability` watches both domains simultaneously
- [ ] `vigilant start --domain unknowndomain` exits with clear error message
- [ ] Knowledge seed files loaded into RAG on first start (appear in `learned_urls` table)
- [ ] Re-running `vigilant start` does not duplicate seed documents in RAG
- [ ] Agent investigation prompt includes domain-specific bad/good example
- [ ] Executor CodeWriter uses strategy bad example for context trimming on large files
- [ ] MCP `get_domain_pattern MISSING_IDEMPOTENCY` returns full fix strategy from payments pack
- [ ] MCP `analyze_snippet` uses all active pack fix strategies as domain context
- [ ] All 22 issue types (7+5+5+5) are detectable end-to-end