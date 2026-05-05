// tests/unit/domain-context.test.ts
// Unit tests for src/agent/domain-context.ts

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

describe('resolveActivePacks', () => {
  it('returns payments pack when domain is payments', () => {
    const packs = resolveActivePacks(BASE_CONFIG);
    expect(packs).toHaveLength(1);
    expect(packs[0].id).toBe('payments');
  });

  it('respects domain override parameter', () => {
    const packs = resolveActivePacks({ ...BASE_CONFIG, domains: ['security'] }, 'security');
    expect(packs.some(p => p.id === 'security')).toBe(true);
  });

  it('returns all 4 packs when all domains specified', () => {
    const packs = resolveActivePacks({ ...BASE_CONFIG, domains: ['payments', 'security', 'reliability', 'compliance'] });
    expect(packs.length).toBe(4);
    const ids = packs.map(p => p.id);
    expect(ids).toContain('payments');
    expect(ids).toContain('security');
    expect(ids).toContain('reliability');
    expect(ids).toContain('compliance');
  });
});

describe('findPackForIssueType', () => {
  it('finds payments pack for MISSING_IDEMPOTENCY_KEY', () => {
    const pack = findPackForIssueType('MISSING_IDEMPOTENCY_KEY');
    expect(pack).not.toBeNull();
    expect(pack!.id).toBe('payments');
  });

  it('finds payments pack for UNVERIFIED_WEBHOOK', () => {
    const pack = findPackForIssueType('UNVERIFIED_WEBHOOK');
    expect(pack!.id).toBe('payments');
  });

  it('returns null/undefined for unknown issue type', () => {
    const pack = findPackForIssueType('NONEXISTENT_ISSUE_TYPE');
    expect(pack).toBeFalsy();
  });
});

describe('buildDomainPromptBlock', () => {
  it('includes domain name in output', () => {
    const pack = findPackForIssueType('MISSING_IDEMPOTENCY_KEY')!;
    const block = buildDomainPromptBlock(pack, 'MISSING_IDEMPOTENCY_KEY');
    expect(block).toContain('Payments');
  });

  it('includes the issue type', () => {
    const pack = findPackForIssueType('MISSING_IDEMPOTENCY_KEY')!;
    const block = buildDomainPromptBlock(pack, 'MISSING_IDEMPOTENCY_KEY');
    expect(block).toContain('MISSING_IDEMPOTENCY_KEY');
  });

  it('returns a non-empty string for any known issue type', () => {
    const pack = findPackForIssueType('UNVERIFIED_WEBHOOK')!;
    const block = buildDomainPromptBlock(pack, 'UNVERIFIED_WEBHOOK');
    expect(block.length).toBeGreaterThan(20);
  });
});
