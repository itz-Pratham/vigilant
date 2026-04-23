# Phase 7 — analyze_snippet Tool

**File:** `src/mcp/tools/analyzeSnippet.ts`

## Objective

Given a raw code snippet pasted by the user into their AI editor, classify it against all active domain patterns and return the detected issue type, severity, and a one-sentence fix suggestion. This is vigilant's "scan-as-you-type" capability.

---

## Implementation

```typescript
// src/mcp/tools/analyzeSnippet.ts
import { NeuroLink }                from '@juspay/neurolink';
import { AnalyzeSnippetInput, AnalyzeSnippetOutput } from '../types.js';
import { loadActiveDomainPacks }    from '../../agent/domain-context.js';
import { loadConfig }               from '../../config.js';

const ANALYZE_PROMPT = (code: string, domainContext: string, language: string) =>
`You are a code security and quality analyst. Classify the following ${language} code snippet against the known issue patterns.

${domainContext}

Code to analyse:
\`\`\`${language}
${code}
\`\`\`

Respond with a JSON object ONLY (no explanation outside JSON):
{
  "issueType":  "<ISSUE_TYPE or null if no issue found>",
  "severity":   "<CRITICAL|HIGH|MEDIUM|LOW or null>",
  "confidence": <0.0 to 1.0>,
  "explanation": "<one paragraph: what the issue is and why it matters>",
  "suggestion": "<one sentence: what to do to fix it>"
}`;

export async function handleAnalyzeSnippet(
  neurolink: NeuroLink,
  input:     AnalyzeSnippetInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const config = await loadConfig();
  const packs  = loadActiveDomainPacks(config);

  // Filter to requested domain if specified
  const activePacks = input.domain
    ? packs.filter(p => p.id === input.domain)
    : packs;

  // Build domain context block
  const domainContext = activePacks.flatMap(pack =>
    pack.fixStrategies.map(s =>
      `Issue: ${s.issueType} (${pack.id}, ${s.severity})\nPattern: ${s.description}`
    )
  ).join('\n\n');

  const { text } = await neurolink.generate({
    prompt:      ANALYZE_PROMPT(input.code, domainContext, input.language),
    provider:    'google',
    model:       'gemini-2.0-flash',
    outputMode:  'json',
  });

  let result: AnalyzeSnippetOutput;
  try {
    result = JSON.parse(text);
  } catch {
    result = {
      issueType:   undefined,
      severity:    undefined,
      confidence:  0,
      explanation: 'Analysis failed — could not parse AI response.',
    };
  }

  const formatted = formatAnalysis(result);
  return { content: [{ type: 'text', text: formatted }] };
}

function formatAnalysis(r: AnalyzeSnippetOutput): string {
  if (!r.issueType || r.confidence < 0.3) {
    return `✅ No issues detected in this snippet (confidence: ${(r.confidence * 100).toFixed(0)}%)`;
  }

  return [
    `⚠️  Issue detected: **${r.issueType}** (${r.severity})`,
    `Confidence: ${(r.confidence * 100).toFixed(0)}%`,
    '',
    r.explanation,
    '',
    `💡 Fix: ${r.suggestion ?? 'See domain pattern documentation.'}`,
  ].join('\n');
}
```

---

## Example Interaction (Cursor)

**User in chat:**
> Analyze this code: `try { await stripe.charges.create(params) } catch(e) {}`

**Cursor calls `analyze_snippet`:**
```
⚠️  Issue detected: SILENT_ERROR_SWALLOW (HIGH)
Confidence: 91%

This code silently swallows any error thrown by the Stripe charge creation call.
If the charge fails (network error, card declined, rate limit), the caller receives
no indication of failure — the payment is assumed to have succeeded.

💡 Fix: Rethrow the error after logging it, or return a typed failure result
to the caller so they can handle the failure state explicitly.
```
