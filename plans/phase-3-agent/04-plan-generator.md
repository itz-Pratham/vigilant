# Phase 3 — Plan Generator

**File:** `src/agent/plan-generator.ts`

## Objective

After the agentic loop reaches `goalProgress >= 0.9`, the plan generator takes the session's accumulated findings and data, makes one final structured NeuroLink call requesting JSON output, and produces a validated `Plan` object. This is the plan shown to the human at Gate 1.

---

## Full Implementation

```typescript
import NeuroLink from '@juspay/neurolink';
import type { IssueSession, Plan, FileChange } from './types';
import { loadConfig } from '@/config/index';
import { loadDomainPack } from './domain-packs';
import { info, error } from '@/lib/logger';
import { saveSession } from '@/db/queries/sessions';

/**
 * Generate a structured Plan from the session's investigation findings.
 * Called after the agent loop completes successfully.
 * Updates session.plan and transitions to 'awaiting_approval'.
 */
export async function generatePlan(session: IssueSession): Promise<IssueSession> {
  const config = loadConfig();
  const domainPack = loadDomainPack(session.domain);

  const neurolink = new NeuroLink({
    providers: [
      config.geminiApiKey ? { name: 'google', apiKey: config.geminiApiKey } : null,
      config.groqApiKey   ? { name: 'groq',   apiKey: config.groqApiKey }   : null,
    ].filter(Boolean),
  });

  const prompt = buildPlanGenerationPrompt(session);

  info('Generating structured plan', session.sessionId);

  session.stage = 'planning';
  saveSession(session);

  let rawResponse;
  try {
    rawResponse = await neurolink.generate({
      messages: [
        { role: 'system', content: PLAN_GENERATION_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      responseFormat: { type: 'json_object' },  // force JSON output
    });
  } catch (err: unknown) {
    error('Plan generation failed', session.sessionId, { error: (err as Error).message });
    session.stage = 'blocked';
    session.blockerReason = `Plan generation failed: ${(err as Error).message}`;
    saveSession(session);
    return session;
  }

  let rawPlan: unknown;
  try {
    rawPlan = JSON.parse(rawResponse.content ?? '{}');
  } catch {
    error('Plan response was not valid JSON', session.sessionId);
    session.stage = 'blocked';
    session.blockerReason = 'Plan generator returned invalid JSON. Retry or investigate manually.';
    saveSession(session);
    return session;
  }

  const validated = validatePlan(rawPlan, session);
  if (!validated) {
    error('Plan validation failed', session.sessionId, { rawPlan });
    session.stage = 'blocked';
    session.blockerReason = 'Generated plan failed validation (missing required fields or empty changes). Review manually.';
    saveSession(session);
    return session;
  }

  session.plan = validated;
  session.branchName = validated.branchName;
  session.stage = 'awaiting_self_review';  // self-review loop (Phase 5) transitions to awaiting_approval
  saveSession(session);

  info('Plan generated successfully', session.sessionId, {
    filesChanged: validated.changes.length,
    confidence: validated.confidence,
    branchName: validated.branchName,
  });

  return session;
}

// ── Prompt Construction ───────────────────────────────────────────────

const PLAN_GENERATION_SYSTEM_PROMPT = `
You are vigilant, an autonomous code intelligence agent generating a fix plan.

Output a single JSON object (no markdown fences) with this exact schema:
{
  "summary": "One sentence describing the issue",
  "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "confidence": 0.0 to 1.0,
  "rootCause": "Multi-sentence explanation of why this is a problem",
  "changes": [
    {
      "path": "repo-relative file path",
      "description": "What this change does",
      "before": "exact code being replaced (empty string if purely additive)",
      "after": "exact replacement code",
      "lineHint": 47,
      "isNewFile": false
    }
  ],
  "branchName": "vigilant/fix/kebab-case-description",
  "prTitle": "fix(issueType): description [vigilant]",
  "prBodyMarkdown": "full PR body in markdown",
  "testSuggestions": ["test case 1", "test case 2"]
}

Rules:
- changes array must have at least 1 item
- before and after must be exact code, not pseudo-code
- branchName must be lowercase kebab-case only
- prTitle must end with [vigilant]
- prBodyMarkdown must include the session ID in a footer
`.trim();

function buildPlanGenerationPrompt(session: IssueSession): string {
  return `
Session: ${session.sessionId}
Repository: ${session.repoOwner}/${session.repoName}
Issue Type: ${session.issueType}
Source: ${session.sourceRef}
Severity (from scanner): ${session.severity}

Key findings from investigation:
${session.keyFindings.map(f => `- ${f}`).join('\n') || '- No specific findings recorded'}

Data collected:
${Object.entries(session.dataCollected)
    .slice(0, 5)  // limit to avoid token overflow
    .map(([k, v]) => `${k}: ${JSON.stringify(v).substring(0, 500)}`)
    .join('\n')}

Generate the fix plan now.
  `.trim();
}

// ── Validation ────────────────────────────────────────────────────────

function validatePlan(raw: unknown, session: IssueSession): Plan | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;

  if (!r.summary || typeof r.summary !== 'string') return null;
  if (!r.rootCause || typeof r.rootCause !== 'string') return null;
  if (!Array.isArray(r.changes) || r.changes.length === 0) return null;
  if (!r.branchName || typeof r.branchName !== 'string') return null;
  if (!r.prTitle || typeof r.prTitle !== 'string') return null;

  const changes: FileChange[] = (r.changes as unknown[]).map((c: unknown) => {
    const change = c as Record<string, unknown>;
    return {
      path: String(change.path ?? ''),
      description: String(change.description ?? ''),
      before: String(change.before ?? ''),
      after: String(change.after ?? ''),
      lineHint: typeof change.lineHint === 'number' ? change.lineHint : undefined,
      isNewFile: Boolean(change.isNewFile),
    };
  }).filter(c => c.path && c.after);

  if (changes.length === 0) return null;

  // Inject session ID into PR body if not already present
  let prBody = String(r.prBodyMarkdown ?? '');
  if (!prBody.includes(session.sessionId)) {
    prBody += `\n\n---\n*Session: \`${session.sessionId}\`*`;
  }

  return {
    summary: String(r.summary),
    severity: (['LOW','MEDIUM','HIGH','CRITICAL'].includes(String(r.severity))
      ? r.severity : session.severity) as Plan['severity'],
    confidence: typeof r.confidence === 'number' ? Math.min(Math.max(r.confidence, 0), 1) : 0.8,
    rootCause: String(r.rootCause),
    changes,
    branchName: String(r.branchName),
    prTitle: String(r.prTitle),
    prBodyMarkdown: prBody,
    testSuggestions: Array.isArray(r.testSuggestions)
      ? (r.testSuggestions as unknown[]).map(String)
      : [],
  };
}
```
