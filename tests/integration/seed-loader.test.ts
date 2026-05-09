// tests/integration/seed-loader.test.ts
// Integration tests for loadDomainSeeds() and loadAllDomainSeeds().

import { describe, it, expect, beforeEach } from 'vitest';
import { resetDbForTesting, getKnowledgeDb } from '../../src/db/index.js';
import { loadDomainSeeds, loadAllDomainSeeds } from '../../src/agent/seed-loader.js';
import { resolveActivePacks }                  from '../../src/agent/domain-context.js';
import type { DomainPack }                     from '../../src/agent/domain-context.js';
import type { VigilantConfig }                 from '../../src/config/types.js';

// ── DB isolation ──────────────────────────────────────────────────────────────

beforeEach(() => {
  process.env['VIGILANT_KNOWLEDGE_DB_PATH'] = ':memory:';
  resetDbForTesting();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const cfg = (domains: string[]): VigilantConfig => ({
  githubToken:          'tok',
  geminiApiKey:         'gm',
  defaultRepos:         [],
  watchIntervalSeconds: 60,
  maxIterations:        20,
  autoMerge:            false,
  domains,
});

function countDocs(): number {
  const db  = getKnowledgeDb();
  const row = db.prepare<[], { c: number }>('SELECT COUNT(*) as c FROM knowledge_documents').get()!;
  return row.c;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('loadDomainSeeds — real knowledge/ files', () => {
  it('loads payments seeds (at least 5 files)', () => {
    const [pack] = resolveActivePacks(cfg(['payments']));
    const added  = loadDomainSeeds(pack);
    expect(added).toBeGreaterThanOrEqual(5);
    expect(countDocs()).toBeGreaterThanOrEqual(5);
  });

  it('loads all 20 seeds across 4 packs via loadAllDomainSeeds', () => {
    const packs = resolveActivePacks(cfg(['payments', 'security', 'reliability', 'compliance']));
    const total = loadAllDomainSeeds(packs);
    expect(total).toBe(20);
    expect(countDocs()).toBe(20);
  });

  it('is idempotent — running twice does not add duplicates', () => {
    const [pack] = resolveActivePacks(cfg(['payments']));
    loadDomainSeeds(pack);
    const after1 = countDocs();
    loadDomainSeeds(pack);
    expect(countDocs()).toBe(after1);
  });

  it('second call returns 0 (all skipped as dedup)', () => {
    const [pack] = resolveActivePacks(cfg(['payments']));
    loadDomainSeeds(pack);
    expect(loadDomainSeeds(pack)).toBe(0);
  });

  it('stores seeds with the correct domain tag', () => {
    const [pack] = resolveActivePacks(cfg(['security']));
    loadDomainSeeds(pack);

    const db   = getKnowledgeDb();
    const rows = db.prepare<[], { domain: string }>('SELECT DISTINCT domain FROM knowledge_documents').all() as { domain: string }[];
    const domains = rows.map(r => r.domain);
    expect(domains).toContain('security');
    expect(domains).not.toContain('payments');
  });

  it('stores seeds with source_type "codebase"', () => {
    const [pack] = resolveActivePacks(cfg(['payments']));
    loadDomainSeeds(pack);

    const db   = getKnowledgeDb();
    const rows = db.prepare<[], { source_type: string }>('SELECT DISTINCT source_type FROM knowledge_documents').all() as { source_type: string }[];
    expect(rows[0]?.source_type).toBe('codebase');
  });

  it('stores seeds with scope "global"', () => {
    const [pack] = resolveActivePacks(cfg(['compliance']));
    loadDomainSeeds(pack);

    const db   = getKnowledgeDb();
    const rows = db.prepare<[], { scope: string }>('SELECT DISTINCT scope FROM knowledge_documents').all() as { scope: string }[];
    expect(rows[0]?.scope).toBe('global');
  });
});

describe('loadDomainSeeds — edge cases', () => {
  it('returns 0 when knowledgeSeedDir is undefined', () => {
    const pack: DomainPack = {
      id: 'mock', name: 'Mock', issueTypes: [], patternRules: [], ciKeywords: [], fixStrategies: {},
    };
    expect(loadDomainSeeds(pack)).toBe(0);
    expect(countDocs()).toBe(0);
  });

  it('returns 0 and does not throw when knowledgeSeedDir does not exist', () => {
    const pack: DomainPack = {
      id: 'mock', name: 'Mock', issueTypes: [], patternRules: [], ciKeywords: [], fixStrategies: {},
      knowledgeSeedDir: '/nonexistent/path/to/seeds',
    };
    expect(() => loadDomainSeeds(pack)).not.toThrow();
    expect(loadDomainSeeds(pack)).toBe(0);
  });

  it('loadAllDomainSeeds with empty array returns 0', () => {
    expect(loadAllDomainSeeds([])).toBe(0);
    expect(countDocs()).toBe(0);
  });
});
