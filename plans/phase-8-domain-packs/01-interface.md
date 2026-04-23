# Phase 8 — DomainPack Interface

**File:** `src/agent/domain-context.ts` (full implementation — Phase 3 defined the shell)

## Objective

Define the canonical `DomainPack`, `FixStrategy`, and `PatternRule` interfaces, the domain pack registry, and all helper functions. Phase 3 sketched these — Phase 8 fills in all four real packs.

---

## Interfaces

```typescript
// src/types.ts (or src/agent/domain-context.ts)

export interface PatternRule {
  /** Unique issue type identifier. */
  issueType:    string;
  /** Human-readable label. */
  label:        string;
  /** Severity: CRITICAL > HIGH > MEDIUM > LOW */
  severity:     'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  /** GitHub Code Search query string. {owner} and {repo} are replaced at runtime. */
  searchQuery:  string;
  /** File glob patterns to restrict search. */
  filePatterns: string[];
  /** Keywords for CI failure detection (matched against job names and step outputs). */
  ciKeywords?:  string[];
}

export interface FixStrategy {
  issueType:       string;
  severity:        'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  description:     string;
  /** Short code snippet demonstrating the bad pattern (TypeScript). */
  badExample:      string;
  /** Short code snippet demonstrating the correct fix (TypeScript). */
  goodExample:     string;
  /** The GitHub code search query (same as PatternRule.searchQuery). */
  searchQuery?:    string;
  /** Context trimming: lines before the bad pattern to include in NeuroLink prompt. */
  contextLinesBefore?: number;
  /** Context trimming: lines after the bad pattern to include in NeuroLink prompt. */
  contextLinesAfter?:  number;
}

export interface DomainPack {
  id:                string;   // 'payments' | 'security' | 'reliability' | 'compliance'
  name:              string;   // Human-readable: 'Payments Domain Pack'
  version:           string;   // Semver: '1.0.0'
  patternRules:      PatternRule[];
  fixStrategies:     FixStrategy[];
  knowledgeSeedDir:  string;   // path to knowledge/{domain}/
  /** Issue types detected from CI failure keyword matching. */
  ciDetectedTypes:   string[];
}
```

---

## Registry and Helpers

```typescript
// src/agent/domain-context.ts

import { payments }   from '../packs/payments.js';
import { security }   from '../packs/security.js';
import { reliability } from '../packs/reliability.js';
import { compliance } from '../packs/compliance.js';
import { VigilantConfig } from '../types.js';
import { DomainPack, FixStrategy } from '../types.js';

const PACK_REGISTRY: Record<string, DomainPack> = {
  payments,
  security,
  reliability,
  compliance,
};

/** Returns all packs enabled in config. */
export function loadActiveDomainPacks(config: VigilantConfig): DomainPack[] {
  return (config.domains ?? ['payments']).map(id => {
    const pack = PACK_REGISTRY[id];
    if (!pack) throw new Error(`Unknown domain pack: "${id}"`);
    return pack;
  });
}

/** Finds the pack and fix strategy for a given issue type. */
export function findPackForIssueType(
  packs:     DomainPack[],
  issueType: string,
): { pack: DomainPack | null; strategy: FixStrategy | null } {
  for (const pack of packs) {
    const strategy = pack.fixStrategies.find(s => s.issueType === issueType);
    if (strategy) return { pack, strategy };
  }
  return { pack: null, strategy: null };
}

/** Builds the domain context prompt block for the agent loop. */
export function buildDomainPromptBlock(pack: DomainPack, issueType: string): string {
  const strategy = pack.fixStrategies.find(s => s.issueType === issueType);
  if (!strategy) return '';

  return `## Domain Context: ${pack.name}
Issue type: ${issueType}
Severity: ${strategy.severity}

${strategy.description}

### Bad pattern:
\`\`\`typescript
${strategy.badExample}
\`\`\`

### Good pattern:
\`\`\`typescript
${strategy.goodExample}
\`\`\``;
}
```

---

## Knowledge Seed Loading

```typescript
// Called once per repo on first start (idempotent via URL dedup):
export async function loadDomainSeeds(
  pack:      DomainPack,
  neurolink: NeuroLink,
  db:        Database.Database,
): Promise<void> {
  const seedDir = pack.knowledgeSeedDir;
  const files   = readdirSync(seedDir).filter(f => f.endsWith('.md'));

  for (const file of files) {
    const content = readFileSync(join(seedDir, file), 'utf-8');
    const url     = `file://${join(seedDir, file)}`;

    const exists = db.prepare(`SELECT 1 FROM learned_urls WHERE url = ?`).get(url);
    if (exists) continue;

    await neurolink.addDocument({
      content,
      metadata: { title: file, url, domain: pack.id, scope: 'global', source_type: 'codebase', tags: pack.id },
    });

    db.prepare(`INSERT INTO learned_urls (url, domain, added_at) VALUES (?, ?, ?)`)
      .run(url, pack.id, Date.now());
  }
}
```
