// src/mcp/tools/analyzeSnippet.ts
// MCP tool: classify a code snippet against domain patterns using NeuroLink.

import { NeuroLink }                            from '@juspay/neurolink';
import { resolveActivePacks }                   from '../../agent/domain-context.js';
import { loadConfig }                           from '../../config/index.js';
import type { AnalyzeSnippetInput, AnalyzeSnippetOutput, ToolResult } from '../types.js';
import { textResult }                           from '../types.js';

const MAX_CODE_CHARS = 8_000;

/**
 * Classifies a code snippet against vigilant domain patterns.
 * Uses NeuroLink to generate a structured JSON analysis.
 */
export async function handleAnalyzeSnippet(
  neurolink: NeuroLink,
  input:     AnalyzeSnippetInput,
): Promise<ToolResult> {
  const config = await loadConfig();
  const packs  = resolveActivePacks(config, input.domain);

  // Build a compact domain context block for the prompt
  const patternLines: string[] = [];
  for (const pack of packs) {
    for (const rule of pack.patternRules) {
      patternLines.push(`- ${rule.issueType} (${pack.id}, ${rule.severity}): ${rule.description}`);
    }
  }
  const domainContext = patternLines.join('\n');

  const code = input.code.slice(0, MAX_CODE_CHARS);

  const prompt = `You are a code security and quality analyst. Analyse the following ${input.language} code snippet against these known issue patterns:

${domainContext}

Code to analyse:
\`\`\`${input.language}
${code}
\`\`\`

Respond with a JSON object ONLY (no prose outside the JSON):
{
  "issueType": "<ISSUE_TYPE or null if no issue>",
  "severity": "<CRITICAL|HIGH|MEDIUM|LOW or null>",
  "confidence": <0.0 to 1.0>,
  "explanation": "<one paragraph: what the issue is and why it matters>",
  "suggestion": "<one sentence: how to fix it>"
}`;

  let parsed: AnalyzeSnippetOutput;
  try {
    const result = await neurolink.generate({
      input:        { text: prompt },
      disableTools: true,
    });

    parsed = parseJsonSafe(result.content);
  } catch {
    parsed = {
      issueType:   null,
      severity:    null,
      confidence:  0,
      explanation: 'Analysis failed — NeuroLink generation error.',
      suggestion:  null,
    };
  }

  return textResult(formatAnalysis(parsed));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip markdown code fences and parse JSON safely. */
function parseJsonSafe(raw: string): AnalyzeSnippetOutput {
  // Remove code fences if present
  const stripped = raw.replace(/^```(?:json)?\s*/im, '').replace(/```\s*$/im, '').trim();
  try {
    const obj = JSON.parse(stripped) as Record<string, unknown>;
    return {
      issueType:   typeof obj['issueType']  === 'string' ? obj['issueType']  : null,
      severity:    typeof obj['severity']   === 'string' ? obj['severity'] as AnalyzeSnippetOutput['severity'] : null,
      confidence:  typeof obj['confidence'] === 'number' ? obj['confidence'] : 0,
      explanation: typeof obj['explanation'] === 'string' ? obj['explanation'] : 'No explanation provided.',
      suggestion:  typeof obj['suggestion'] === 'string' ? obj['suggestion'] : null,
    };
  } catch {
    return {
      issueType:   null,
      severity:    null,
      confidence:  0,
      explanation: 'Could not parse AI response. Raw output: ' + raw.slice(0, 200),
      suggestion:  null,
    };
  }
}

function formatAnalysis(r: AnalyzeSnippetOutput): string {
  if (!r.issueType || r.confidence < 0.3) {
    return `✅ No significant issues detected (confidence: ${(r.confidence * 100).toFixed(0)}%)\n\n${r.explanation}`;
  }

  const lines = [
    `⚠️  Issue detected: **${r.issueType}** (${r.severity ?? 'UNKNOWN'})`,
    `Confidence: ${(r.confidence * 100).toFixed(0)}%`,
    '',
    r.explanation,
  ];

  if (r.suggestion) {
    lines.push('', `💡 Fix: ${r.suggestion}`);
  }

  return lines.join('\n');
}
