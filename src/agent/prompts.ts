// src/agent/prompts.ts
// Builds system prompts and iteration context messages for the agent loop.
// Also extracts the progress JSON trailer from model responses.

import type { IssueSession } from './types.js';
import type { DomainPack }   from './domain-context.js';
import { buildDomainPromptBlock } from './domain-context.js';

// ── System prompt ─────────────────────────────────────────────────────────────

export function buildInvestigationSystemPrompt(
  session: IssueSession,
  pack:    DomainPack,
): string {
  const domainBlock = buildDomainPromptBlock(pack, session.issueType);

  return `You are vigilant, an autonomous code-review agent specializing in ${pack.name} engineering.

Your mission: investigate a potential ${session.issueType} issue in the repository \`${session.repoOwner}/${session.repoName}\` and collect enough evidence to either confirm or rule it out.

${domainBlock}

## Your investigation workflow
1. Use the tools available to read files, search code, inspect git history, and query the knowledge base.
2. After every response, output a JSON progress block (required — see below).
3. Stop investigating when you have ≥ 70% confidence in the root cause and a clear fix approach.

## Available tools
- \`getCurrentTime\` — called automatically on step 0
- \`sequentialThinking\` — call early to plan your investigation steps
- \`readFile\` — read any file in the repository
- \`searchCode\` — GitHub code search for patterns
- \`ragSearch\` — search past fixes / runbooks in the knowledge base
- \`readPRDiff\` — read a pull request's diff
- \`readGitHistory\` — see commit history for a file
- \`readTeamDecisions\` — fetch team ADRs and conventions

## REQUIRED: Progress JSON trailer
Every response MUST end with this exact JSON block. No exceptions:

\`\`\`json
{
  "goalProgress": 0.0,
  "keyFindings": []
}
\`\`\`

- \`goalProgress\`: float 0.0–1.0 representing your confidence that you have enough evidence to generate a fix plan.
- \`keyFindings\`: array of short strings (≤ 10 items) summarising what you have found so far.

Do NOT output this JSON block in the middle of your response — only at the very end.`;
}

// ── Per-iteration context ─────────────────────────────────────────────────────

export function buildIterationContext(session: IssueSession, iteration: number): string {
  const lines: string[] = [
    `## Iteration ${iteration + 1} of ${session.iterationCount + 1}`,
    `Session: ${session.sessionId}`,
    `Issue:   ${session.issueType} (${session.severity}) — confidence ${(session.confidence * 100).toFixed(0)}%`,
    `Repo:    ${session.repoOwner}/${session.repoName}`,
    `Source ref: ${session.sourceRef}`,
    '',
  ];

  if (session.evidence.length > 0) {
    lines.push('## Initial evidence from scanner');
    session.evidence.forEach(e => lines.push(`- ${e}`));
    lines.push('');
  }

  if (session.keyFindings.length > 0) {
    lines.push('## Key findings so far');
    session.keyFindings.forEach(f => lines.push(`- ${f}`));
    lines.push('');
  }

  if (session.goalProgress > 0) {
    lines.push(`Current goal progress: ${(session.goalProgress * 100).toFixed(0)}%`);
    lines.push('');
  }

  if (iteration === 0) {
    lines.push('Start your investigation. Use sequentialThinking first to plan your approach.');
  } else {
    lines.push('Continue your investigation. What still needs to be confirmed before you can write the fix?');
  }

  return lines.join('\n');
}

// ── Progress extraction ───────────────────────────────────────────────────────

type ProgressUpdate = {
  goalProgress: number;
  keyFindings:  string[];
};

/**
 * Extracts the required JSON progress trailer from the model's response content.
 * Falls back to current session values if no valid JSON block is found.
 */
export function extractProgressUpdate(content: string, session: IssueSession): ProgressUpdate {
  // Match the last ```json ... ``` block in the response
  const jsonBlockRe = /```json\s*([\s\S]*?)```/g;
  let lastMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = jsonBlockRe.exec(content)) !== null) {
    lastMatch = m;
  }

  if (lastMatch) {
    try {
      const parsed = JSON.parse(lastMatch[1]) as unknown;
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'goalProgress' in parsed &&
        'keyFindings' in parsed &&
        typeof (parsed as Record<string, unknown>)['goalProgress'] === 'number' &&
        Array.isArray((parsed as Record<string, unknown>)['keyFindings'])
      ) {
        const p = parsed as { goalProgress: number; keyFindings: string[] };
        return {
          goalProgress: Math.min(1.0, Math.max(0.0, p.goalProgress)),
          keyFindings:  p.keyFindings.slice(0, 10),
        };
      }
    } catch {
      // fall through to fallback
    }
  }

  // Regex fallback: look for inline JSON object pattern
  const inlineRe = /"goalProgress"\s*:\s*([0-9.]+)/;
  const inlineMatch = inlineRe.exec(content);
  if (inlineMatch) {
    const progress = parseFloat(inlineMatch[1]);
    if (!isNaN(progress)) {
      return { goalProgress: Math.min(1.0, progress), keyFindings: session.keyFindings };
    }
  }

  // No progress info found — return current values unchanged
  return { goalProgress: session.goalProgress, keyFindings: session.keyFindings };
}
