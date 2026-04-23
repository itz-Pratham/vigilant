# Phase 3 — Domain Context

**Files:** `src/agent/domainContext.ts`, `src/domains/{payments,security,reliability,compliance}.ts`

## Objective

Defines the `DomainPack` interface, assembles the domain-specific prompt block injected into every investigation, and loads seed markdown files into the RAG store on first daemon start.

---

## Types

```typescript
// src/agent/domainContext.ts

export type FixStrategy = {
  issueType: string;
  /** 2–3 sentences: what is wrong and why it matters */
  explanation: string;
  exampleBefore: string;  // short problematic code snippet (≤15 lines)
  exampleAfter: string;   // the correct fix, same length
  investigationHints: string[];  // concrete file/code things to look for
  priorityFiles: string[];       // globs — agent reads these first
};

export type PatternRule = {
  id: string;
  issueType: string;
  description: string;
  searchQuery: string;           // GitHub Search API query string
  filePathPattern?: string;      // regex to filter matched file paths
  severity: Severity;
  confidenceScore: number;       // 0.1–1.0
  ciJobKeywords?: string[];
  watchedFilePaths?: string[];   // globs for PR/commit scanners
};

export type DomainPack = {
  id: string;           // 'payments' | 'security' | 'reliability' | 'compliance'
  name: string;
  issueTypes: string[];
  patternRules: PatternRule[];
  filePathPatterns: string[];    // PR scanner scope
  ciKeywords: string[];          // CI scanner job name substrings
  knowledgeSeedDir: string;      // absolute path to knowledge/{domain}/
  fixStrategies: Record<string, FixStrategy>;
};
```

---

## buildDomainContext

Assembles the text block injected at the end of the investigation system prompt.

```typescript
export function buildDomainPromptBlock(pack: DomainPack, issueType: string): string {
  const s = pack.fixStrategies[issueType];
  if (!s) return `No fix strategy registered for ${issueType}. Use general best practices.`;

  return [
    `## Domain Fix Guidance (${issueType})`,
    `**Problem:** ${s.explanation}`,
    `**Before:**\n\`\`\`typescript\n${s.exampleBefore}\n\`\`\``,
    `**After:**\n\`\`\`typescript\n${s.exampleAfter}\n\`\`\``,
    `**Investigation hints:**`,
    s.investigationHints.map((h, i) => `${i + 1}. ${h}`).join('\n'),
    `**Priority files:** ${s.priorityFiles.join(', ')}`,
  ].join('\n\n');
}
```

---

## loadDomainSeeds

Reads all `.md` files from `knowledge/{domain}/` into the global RAG scope. Idempotent — skips files whose `source_url` already exists.

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { addKnowledgeDocument } from '@/rag';

export async function loadDomainSeeds(pack: DomainPack): Promise<void> {
  if (!fs.existsSync(pack.knowledgeSeedDir)) return;

  const files = fs.readdirSync(pack.knowledgeSeedDir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const topic     = path.basename(file, '.md');
    const content   = fs.readFileSync(path.join(pack.knowledgeSeedDir, file), 'utf8');
    const sourceUrl = `file://vigilant/knowledge/${pack.id}/${file}`;
    addKnowledgeDocument({ scope: 'global', domain: pack.id, topic, sourceUrl, content });
  }
}
```

---

## Domain Pack Registry

```typescript
import { paymentsDomainPack }    from '@/domains/payments';
import { securityDomainPack }    from '@/domains/security';
import { reliabilityDomainPack } from '@/domains/reliability';
import { complianceDomainPack }  from '@/domains/compliance';

const REGISTRY: Record<string, DomainPack> = {
  payments:    paymentsDomainPack,
  security:    securityDomainPack,
  reliability: reliabilityDomainPack,
  compliance:  complianceDomainPack,
};

export function loadActiveDomainPacks(config: VigilantConfig): DomainPack[] {
  return (config.domains ?? ['payments']).map(id => {
    if (!REGISTRY[id]) throw new VigilantError(`Unknown domain pack: '${id}'`);
    return REGISTRY[id];
  });
}

export function findPackForIssueType(packs: DomainPack[], issueType: string): DomainPack | null {
  return packs.find(p => p.issueTypes.includes(issueType)) ?? null;
}
```

---

## Seed File Layout

```
knowledge/
├── payments/     idempotency-keys.md, webhook-signature-verify.md,
│                 payment-error-codes.md, circuit-breaker-pattern.md, retry-strategies.md
├── security/     secret-scanning.md, sql-injection-prevention.md,
│                 auth-middleware-patterns.md, input-validation.md, pii-handling.md
├── reliability/  timeout-configuration.md, circuit-breakers.md,
│                 promise-handling.md, retry-with-backoff.md, n-plus-one-prevention.md
└── compliance/   pii-in-logs.md, encrypted-pii-storage.md,
                  audit-trail-patterns.md, gdpr-deletion-pathways.md, data-retention-policies.md
```
