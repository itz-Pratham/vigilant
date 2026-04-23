# Phase 7 — get_domain_pattern Tool

**File:** `src/mcp/tools/getDomainPattern.ts`

## Objective

Return the complete pattern description for any issue type — including the bad code example, good code example, why it matters, and the GitHub search query vigilant uses to find it. Useful for learning what vigilant looks for and why.

---

## Implementation

```typescript
// src/mcp/tools/getDomainPattern.ts
import { GetDomainPatternInput, DomainPatternOutput } from '../types.js';
import { loadActiveDomainPacks, findPackForIssueType } from '../../agent/domain-context.js';
import { loadConfig }  from '../../config.js';

export async function handleGetDomainPattern(
  input: GetDomainPatternInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const config = await loadConfig();
  const packs  = loadActiveDomainPacks(config);

  const { pack, strategy } = findPackForIssueType(packs, input.issueType.toUpperCase());

  if (!strategy) {
    return {
      content: [{
        type: 'text',
        text: `Unknown issue type: \`${input.issueType}\`\n\nAvailable issue types:\n${
          packs.flatMap(p => p.fixStrategies.map(s => `  • ${s.issueType} (${p.id})`)).join('\n')
        }`,
      }],
    };
  }

  const text = [
    `## ${strategy.issueType}`,
    `**Domain:** ${pack!.id}  |  **Severity:** ${strategy.severity}`,
    '',
    strategy.description,
    '',
    '### ❌ Bad pattern',
    '```typescript',
    strategy.badExample,
    '```',
    '',
    '### ✅ Good pattern',
    '```typescript',
    strategy.goodExample,
    '```',
    '',
    `**GitHub search query vigilant uses:**`,
    `\`\`\``,
    strategy.searchQuery ?? `repo:{owner}/{repo} ${strategy.issueType.toLowerCase().replace(/_/g, ' ')}`,
    `\`\`\``,
  ].join('\n');

  return { content: [{ type: 'text', text }] };
}
```

---

## Example Output (in Claude Desktop)

```
## MISSING_IDEMPOTENCY
**Domain:** payments  |  **Severity:** CRITICAL

Payment API calls without idempotency keys risk creating duplicate charges
when requests are retried due to network failures or timeouts.

### ❌ Bad pattern
```typescript
await stripe.charges.create({
  amount:   1000,
  currency: 'usd',
  source:   token,
});
```

### ✅ Good pattern
```typescript
await stripe.charges.create({
  amount:        1000,
  currency:      'usd',
  source:        token,
  idempotencyKey: uuidv4(),   // unique per request
});
```

**GitHub search query vigilant uses:**
```
repo:{owner}/{repo} charges.create NOT idempotencyKey language:TypeScript
```
```
