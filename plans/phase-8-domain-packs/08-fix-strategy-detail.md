# Phase 8 — Fix Strategy Detail

**File:** Reference for NeuroLink prompt construction from fix strategies.

## Objective

Document how the executor's `CodeWriter` uses `FixStrategy` data to build targeted prompts — specifically context trimming, bad/good examples as few-shot context, and per-domain special handling.

---

## Prompt Construction in CodeWriter

```typescript
// Extended FIX_PROMPT using FixStrategy (from Phase 5 code-writer.ts):
const FIX_PROMPT = (
  path:      string,
  session:   IssueSession,
  change:    FileChange,
  original:  string,
  strategy:  FixStrategy | null,
) => {
  const fewShot = strategy ? `
### Bad pattern to look for:
\`\`\`typescript
${strategy.badExample}
\`\`\`

### Target pattern to apply:
\`\`\`typescript
${strategy.goodExample}
\`\`\`
` : '';

  return `You are applying a targeted code fix.

File: ${path}
Issue type: ${session.issueType}
Required change: ${change.description}

${fewShot}

Original file content:
\`\`\`
${original}
\`\`\`

Return ONLY the complete updated file content. No explanation. No markdown fences.`;
};
```

---

## Context Trimming (Large Files)

For files > 50KB, trimming prevents exceeding NeuroLink's context window:

```typescript
function trimAroundBadPattern(
  content:  string,
  strategy: FixStrategy,
  change:   FileChange,
): string {
  const lines        = content.split('\n');
  const linesBefore  = strategy.contextLinesBefore ?? 30;
  const linesAfter   = strategy.contextLinesAfter  ?? 30;

  // Find the line most likely to contain the bad pattern
  const badKeyword  = extractKeyword(strategy.badExample);
  const matchIndex  = lines.findIndex(l => l.includes(badKeyword));

  if (matchIndex === -1) {
    // Fallback: return first 200 lines
    return lines.slice(0, 200).join('\n');
  }

  const start = Math.max(0, matchIndex - linesBefore);
  const end   = Math.min(lines.length, matchIndex + linesAfter);
  return lines.slice(start, end).join('\n');
}

function extractKeyword(badExample: string): string {
  // Take first meaningful identifier from bad example
  const match = badExample.match(/\w{5,}/);
  return match?.[0] ?? '';
}
```

---

## Per-Domain Context Window Budget

| Domain | Avg file changes | Files > 50KB? | Context trimming used? |
|---|---|---|---|
| payments | 1–2 files | Rare | Uncommon |
| security | 1 file | Possible (large routes file) | Yes — trim around bad pattern |
| reliability | 1–3 files | Possible (service file) | Yes |
| compliance | 1–3 files | Rare | Uncommon |

---

## Issue Types That Require Full File Context

Some fixes need the entire file (not just the bad pattern) because the fix involves adding an import, adding a function, or restructuring a class:

| Issue Type | Why full context needed |
|---|---|
| `MISSING_IDEMPOTENCY` | Needs to see the import section to add `uuid` import |
| `MISSING_AUTH_CHECK` | Needs to see the router setup to add middleware correctly |
| `GDPR_RIGHT_TO_DELETE_GAP` | Needs to see the full user service to add a new function |

For these: send the full file (up to context limit) rather than trimmed context.
