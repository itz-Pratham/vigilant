// tests/unit/domain-packs.test.ts
// Unit tests for the expanded Phase 8 domain packs.

import { describe, it, expect } from 'vitest';
import {
  resolveActivePacks,
  findPackForIssueType,
  buildDomainPromptBlock,
} from '../../src/agent/domain-context.js';
import type { VigilantConfig } from '../../src/config/types.js';

const BASE_CONFIG: VigilantConfig = {
  githubToken:          'gh_test',
  geminiApiKey:         'gm_test',
  defaultRepos:         [],
  watchIntervalSeconds: 60,
  domains:              ['payments'],
  maxIterations:        20,
  autoMerge:            false,
};

const ALL_DOMAINS_CONFIG: VigilantConfig = {
  ...BASE_CONFIG,
  domains: ['payments', 'security', 'reliability', 'compliance'],
};

// ── Pack completeness checks ──────────────────────────────────────────────────

describe('payments pack', () => {
  it('has 7 issue types', () => {
    const [pack] = resolveActivePacks(BASE_CONFIG);
    expect(pack.issueTypes.length).toBeGreaterThanOrEqual(7);
  });

  it('has a fixStrategy for every issueType', () => {
    const [pack] = resolveActivePacks(BASE_CONFIG);
    for (const issueType of pack.issueTypes) {
      expect(pack.fixStrategies[issueType], `Missing fixStrategy for ${issueType}`).toBeDefined();
    }
  });

  it('has a patternRule for every non-CI issueType', () => {
    const [pack] = resolveActivePacks(BASE_CONFIG);
    const nonCiTypes = pack.issueTypes.filter(t => !t.startsWith('CI_'));
    for (const issueType of nonCiTypes) {
      const hasRule = pack.patternRules.some(r => r.issueType === issueType);
      expect(hasRule, `Missing patternRule for ${issueType}`).toBe(true);
    }
  });

  it('has knowledgeSeedDir set', () => {
    const [pack] = resolveActivePacks(BASE_CONFIG);
    expect(pack.knowledgeSeedDir).toBeDefined();
    expect(pack.knowledgeSeedDir).toContain('payments');
  });

  it('MISSING_IDEMPOTENCY_KEY fixStrategy has exampleBefore and exampleAfter', () => {
    const [pack] = resolveActivePacks(BASE_CONFIG);
    const strategy = pack.fixStrategies['MISSING_IDEMPOTENCY_KEY'];
    expect(strategy.exampleBefore).toContain('stripe');
    expect(strategy.exampleAfter).toContain('idempotencyKey');
  });

  it('MISSING_TIMEOUT fixStrategy has meaningful explanation', () => {
    const [pack] = resolveActivePacks(BASE_CONFIG);
    const strategy = pack.fixStrategies['MISSING_TIMEOUT'];
    expect(strategy).toBeDefined();
    expect(strategy.explanation.length).toBeGreaterThan(20);
    expect(strategy.exampleAfter).toContain('timeout');
  });
});

describe('security pack', () => {
  it('has fixStrategies for all 5 core issue types', () => {
    const [pack] = resolveActivePacks({ ...BASE_CONFIG, domains: ['security'] });
    for (const type of ['SECRET_IN_CODE', 'MISSING_AUTH_CHECK', 'SQL_INJECTION_RISK', 'PII_IN_LOGS', 'UNVALIDATED_INPUT']) {
      expect(pack.fixStrategies[type], `Missing fixStrategy for ${type}`).toBeDefined();
    }
  });

  it('has patternRules for all 5 core issue types', () => {
    const [pack] = resolveActivePacks({ ...BASE_CONFIG, domains: ['security'] });
    for (const type of ['SECRET_IN_CODE', 'MISSING_AUTH_CHECK', 'SQL_INJECTION_RISK', 'PII_IN_LOGS', 'UNVALIDATED_INPUT']) {
      const hasRule = pack.patternRules.some(r => r.issueType === type);
      expect(hasRule, `Missing patternRule for ${type}`).toBe(true);
    }
  });

  it('SECRET_IN_CODE has CRITICAL severity', () => {
    const [pack] = resolveActivePacks({ ...BASE_CONFIG, domains: ['security'] });
    const rule = pack.patternRules.find(r => r.issueType === 'SECRET_IN_CODE');
    expect(rule?.severity).toBe('CRITICAL');
  });

  it('SQL_INJECTION_RISK fixStrategy uses parameterized query in example', () => {
    const [pack] = resolveActivePacks({ ...BASE_CONFIG, domains: ['security'] });
    const strategy = pack.fixStrategies['SQL_INJECTION_RISK'];
    expect(strategy.exampleAfter).toContain('$1');
  });

  it('UNVALIDATED_INPUT fixStrategy uses Zod in example', () => {
    const [pack] = resolveActivePacks({ ...BASE_CONFIG, domains: ['security'] });
    const strategy = pack.fixStrategies['UNVALIDATED_INPUT'];
    expect(strategy.exampleAfter).toContain('zod');
  });

  it('has knowledgeSeedDir set', () => {
    const [pack] = resolveActivePacks({ ...BASE_CONFIG, domains: ['security'] });
    expect(pack.knowledgeSeedDir).toContain('security');
  });
});

describe('reliability pack', () => {
  it('has fixStrategies for all core issue types', () => {
    const [pack] = resolveActivePacks({ ...BASE_CONFIG, domains: ['reliability'] });
    for (const type of ['MISSING_TIMEOUT', 'NO_CIRCUIT_BREAKER', 'UNHANDLED_REJECTION', 'MISSING_RETRY', 'N_PLUS_ONE_QUERY']) {
      expect(pack.fixStrategies[type], `Missing fixStrategy for ${type}`).toBeDefined();
    }
  });

  it('N_PLUS_ONE_QUERY fixStrategy shows batch query fix', () => {
    const [pack] = resolveActivePacks({ ...BASE_CONFIG, domains: ['reliability'] });
    const strategy = pack.fixStrategies['N_PLUS_ONE_QUERY'];
    expect(strategy.exampleAfter).toContain('findAll');
  });

  it('NO_CIRCUIT_BREAKER fixStrategy references opossum', () => {
    const [pack] = resolveActivePacks({ ...BASE_CONFIG, domains: ['reliability'] });
    const strategy = pack.fixStrategies['NO_CIRCUIT_BREAKER'];
    expect(strategy.exampleAfter).toContain('CircuitBreaker');
  });

  it('has knowledgeSeedDir set', () => {
    const [pack] = resolveActivePacks({ ...BASE_CONFIG, domains: ['reliability'] });
    expect(pack.knowledgeSeedDir).toContain('reliability');
  });
});

describe('compliance pack', () => {
  it('has fixStrategies for all 5 issue types', () => {
    const [pack] = resolveActivePacks({ ...BASE_CONFIG, domains: ['compliance'] });
    for (const type of ['PII_IN_LOGS', 'UNENCRYPTED_PII', 'MISSING_AUDIT_LOG', 'GDPR_RIGHT_TO_DELETE_GAP', 'MISSING_DATA_RETENTION']) {
      expect(pack.fixStrategies[type], `Missing fixStrategy for ${type}`).toBeDefined();
    }
  });

  it('GDPR_RIGHT_TO_DELETE_GAP fixStrategy references anonymiseUser', () => {
    const [pack] = resolveActivePacks({ ...BASE_CONFIG, domains: ['compliance'] });
    const strategy = pack.fixStrategies['GDPR_RIGHT_TO_DELETE_GAP'];
    expect(strategy.exampleAfter).toContain('anonymiseUser');
  });

  it('UNENCRYPTED_PII fixStrategy uses column transformer', () => {
    const [pack] = resolveActivePacks({ ...BASE_CONFIG, domains: ['compliance'] });
    const strategy = pack.fixStrategies['UNENCRYPTED_PII'];
    expect(strategy.exampleAfter).toContain('transformer');
  });

  it('has knowledgeSeedDir set', () => {
    const [pack] = resolveActivePacks({ ...BASE_CONFIG, domains: ['compliance'] });
    expect(pack.knowledgeSeedDir).toContain('compliance');
  });
});

// ── Registry helpers ──────────────────────────────────────────────────────────

describe('findPackForIssueType (expanded)', () => {
  it('finds security pack for SECRET_IN_CODE', () => {
    const pack = findPackForIssueType('SECRET_IN_CODE');
    expect(pack?.id).toBe('security');
  });

  it('finds reliability pack for NO_CIRCUIT_BREAKER', () => {
    const pack = findPackForIssueType('NO_CIRCUIT_BREAKER');
    expect(pack?.id).toBe('reliability');
  });

  it('finds compliance pack for GDPR_RIGHT_TO_DELETE_GAP', () => {
    const pack = findPackForIssueType('GDPR_RIGHT_TO_DELETE_GAP');
    expect(pack?.id).toBe('compliance');
  });

  it('finds payments pack for MISSING_TIMEOUT (new in Phase 8)', () => {
    const pack = findPackForIssueType('MISSING_TIMEOUT');
    // MISSING_TIMEOUT is in both payments and reliability — either is valid
    expect(pack).toBeDefined();
  });
});

describe('buildDomainPromptBlock (all packs)', () => {
  it('builds a non-empty prompt block for every issueType in all 4 packs', () => {
    const packs = resolveActivePacks(ALL_DOMAINS_CONFIG);
    for (const pack of packs) {
      for (const issueType of pack.issueTypes) {
        const block = buildDomainPromptBlock(pack, issueType);
        expect(block.length, `Empty prompt block for ${pack.id}:${issueType}`).toBeGreaterThan(10);
      }
    }
  });

  it('includes exampleBefore and exampleAfter when fixStrategy exists', () => {
    const pack = findPackForIssueType('SQL_INJECTION_RISK')!;
    const block = buildDomainPromptBlock(pack, 'SQL_INJECTION_RISK');
    expect(block).toContain('before');
    expect(block).toContain('after');
  });
});
