// src/agent/plan-generator.ts
// Generates a structured fix plan from the investigation session using a single AI call.
// Uses output: { format: 'json' } + disableTools: true (required for Google providers).

import { NeuroLink }        from '@juspay/neurolink';
import { info, warn }       from '../lib/logger.js';
import { saveSession }      from '../db/queries/sessions.js';
import { STAGE, BRANCH_PREFIX } from '../lib/constants.js';
import { AIProviderError }  from '../lib/errors.js';
import type { IssueSession, Plan, FileChange, IssueSeverity } from './types.js';
import type { DomainPack }   from './domain-context.js';
import type { VigilantConfig } from '../config/types.js';

export async function generatePlan(
  session: IssueSession,
  pack:    DomainPack,
  config:  VigilantConfig,
): Promise<Plan> {
  if (!config.geminiApiKey) {
    throw new AIProviderError('VIGILANT_GEMINI_API_KEY is not configured', undefined, 'google-ai');
  }

  const systemPrompt = buildPlanSystemPrompt(session, pack);
  const userPrompt   = buildPlanUserPrompt(session);

  info(`Generating fix plan for ${session.sessionId}`, 'plan-generator');

  const neurolink = new NeuroLink();
  const result    = await neurolink.generate({
    input:        { text: userPrompt },
    systemPrompt,
    provider:     'google-ai',
    credentials:  { googleAiStudio: { apiKey: config.geminiApiKey } },
    disableTools: true,
    output:       { format: 'json' },
  });

  let plan: Plan;
  try {
    const parsed = JSON.parse(result.content) as unknown;
    plan = validatePlan(parsed, session);
  } catch (err) {
    warn(`Plan JSON parse failed: ${err instanceof Error ? err.message : String(err)}`, 'plan-generator');
    throw new AIProviderError(
      `Plan generation returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      'google-ai',
    );
  }

  session.plan  = plan;
  session.stage = STAGE.PLANNING;
  saveSession(session);

  info(`Plan generated: ${plan.changes.length} file change(s) for ${session.sessionId}`, 'plan-generator');
  return plan;
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildPlanSystemPrompt(session: IssueSession, pack: DomainPack): string {
  return `You are vigilant, a code-fix plan generator for ${pack.name} issues.

Based on the investigation findings provided, generate a precise and minimal fix plan.

You MUST respond with ONLY valid JSON — no markdown, no preamble, no code fences.

Required JSON structure:
{
  "summary": "One sentence describing the fix",
  "severity": "${session.severity}",
  "confidence": <float 0-1>,
  "rootCause": "Detailed explanation of the root cause",
  "changes": [
    {
      "path": "repo-relative/file/path.ts",
      "description": "What this change does",
      "before": "exact code being replaced (empty string if additive)",
      "after": "exact replacement code",
      "lineHint": <optional line number>,
      "isNewFile": false
    }
  ],
  "branchName": "vigilant/fix/ISSUE_TYPE_short_description",
  "prTitle": "[vigilant] Fix: short description",
  "prBodyMarkdown": "## Summary\\n...\\n## Changes\\n...",
  "testSuggestions": ["suggestion 1", "suggestion 2"]
}

Rules:
- "before" must be exact code that exists in the file — copy it verbatim from the findings
- "after" must be minimal — only change what is necessary to fix the issue
- Prefer fewer, smaller changes over large rewrites
- branchName must follow the pattern: vigilant/fix/lowercase-kebab-description
- prBodyMarkdown must explain the issue, the fix, and testing steps`;
}

function buildPlanUserPrompt(session: IssueSession): string {
  const findings = session.keyFindings.length > 0
    ? session.keyFindings.map(f => `- ${f}`).join('\n')
    : '(no findings recorded)';

  const dataKeys = Object.keys(session.dataCollected)
    .filter(k => k.startsWith('file_') || k.startsWith('search_') || k.startsWith('investigationPlan'))
    .slice(0, 5);

  const dataSnippets = dataKeys.map(k => {
    const val = session.dataCollected[k];
    return `### ${k}\n${JSON.stringify(val, null, 2).slice(0, 800)}`;
  }).join('\n\n');

  return `## Session: ${session.sessionId}
Issue type: ${session.issueType}
Severity:   ${session.severity}
Confidence: ${(session.goalProgress * 100).toFixed(0)}%
Repo:       ${session.repoOwner}/${session.repoName}

## Key findings from investigation
${findings}

## Evidence collected
${dataSnippets || '(no code evidence recorded)'}

Generate the fix plan JSON now.`;
}

// ── Validation ────────────────────────────────────────────────────────────────

function validatePlan(raw: unknown, session: IssueSession): Plan {
  if (!raw || typeof raw !== 'object') throw new Error('plan is not an object');

  const r = raw as Record<string, unknown>;

  const summary       = typeof r['summary'] === 'string'    ? r['summary']    : `Fix ${session.issueType}`;
  const confidence    = typeof r['confidence'] === 'number' ? r['confidence'] : session.goalProgress;
  const rootCause     = typeof r['rootCause'] === 'string'  ? r['rootCause']  : 'See investigation findings';
  const prBodyMd      = typeof r['prBodyMarkdown'] === 'string' ? r['prBodyMarkdown'] : `Fixes ${session.issueType}`;
  const prTitle       = typeof r['prTitle'] === 'string'    ? r['prTitle']    : `[vigilant] Fix ${session.issueType}`;

  const SEVERITIES: IssueSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  const severity: IssueSeverity = SEVERITIES.includes(r['severity'] as IssueSeverity)
    ? (r['severity'] as IssueSeverity)
    : session.severity;

  const rawBranch  = typeof r['branchName'] === 'string' ? r['branchName'] : '';
  const branchName = rawBranch.startsWith(BRANCH_PREFIX)
    ? rawBranch
    : `${BRANCH_PREFIX}/${session.issueType.toLowerCase().replace(/_/g, '-')}`;

  const testSuggestions = Array.isArray(r['testSuggestions'])
    ? (r['testSuggestions'] as unknown[]).filter(s => typeof s === 'string') as string[]
    : [];

  const rawChanges = Array.isArray(r['changes']) ? r['changes'] : [];
  const changes: FileChange[] = rawChanges
    .filter(c => c && typeof c === 'object')
    .map(c => {
      const fc = c as Record<string, unknown>;
      return {
        path:        typeof fc['path'] === 'string'        ? fc['path']        : 'unknown',
        description: typeof fc['description'] === 'string' ? fc['description'] : '',
        before:      typeof fc['before'] === 'string'      ? fc['before']      : '',
        after:       typeof fc['after'] === 'string'       ? fc['after']       : '',
        lineHint:    typeof fc['lineHint'] === 'number'    ? fc['lineHint']    : undefined,
        isNewFile:   fc['isNewFile'] === true,
      };
    });

  return {
    summary,
    severity,
    confidence,
    rootCause,
    changes,
    branchName,
    prTitle,
    prBodyMarkdown: prBodyMd,
    testSuggestions,
  };
}
