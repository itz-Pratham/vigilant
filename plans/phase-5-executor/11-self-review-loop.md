# Phase 5 — Self-Review Loop

**File:** `src/executor/self-reviewer.ts`

## Objective

Before Gate 1 is shown, vigilant reads its own planned diff, applies domain knowledge, and checks for issues it may have introduced. Max 3 iterations. If issues are found, corrections are pushed to the plan. After 3 iterations (or a clean pass), the session advances to `awaiting_approval`.

This ensures Gate 1 always shows a PR that vigilant has already verified.

---

## Types

```typescript
// Added to src/executor/types.ts

export type SelfReviewResult = {
  /** true if the review pass found no issues */
  clean: boolean;
  /** Issues found (may be empty). Used to refine the plan. */
  issues: SelfReviewIssue[];
  /** Which iteration number this was (1, 2, or 3) */
  iterationNumber: number;
};

export type SelfReviewIssue = {
  /** Short description of the issue found */
  description: string;
  /** Which file in the plan this applies to */
  file: string;
  /** Suggested correction */
  suggestion: string;
};
```

---

## Implementation

```typescript
// src/executor/self-reviewer.ts

import { NeuroLink }       from '@juspay/neurolink';
import { saveSession }     from '@/agent/state-manager';
import { info, warn }      from '@/lib/logger';
import { MAX_SELF_REVIEW_ITERATIONS } from '@/lib/constants';
import type { IssueSession }    from '@/agent/types';
import type { SelfReviewResult, SelfReviewIssue } from './types';

/**
 * Runs the self-review loop for a session.
 * Session must be in 'awaiting_self_review' stage.
 * Advances session to 'awaiting_approval' when done.
 * Maximum MAX_SELF_REVIEW_ITERATIONS (3) iterations.
 */
export async function runSelfReview(
  session: IssueSession,
  neurolink: NeuroLink,
): Promise<IssueSession> {
  let current = { ...session, stage: 'self_reviewing' as const };
  saveSession(current);

  for (let i = 1; i <= MAX_SELF_REVIEW_ITERATIONS; i++) {
    info(`Self-review iteration ${i}/${MAX_SELF_REVIEW_ITERATIONS}`, current.sessionId);
    const result = await reviewOncePlan(current, neurolink, i);

    current = { ...current, selfReviewCount: i };
    saveSession(current);

    if (result.clean) {
      info(`Self-review clean on iteration ${i}`, current.sessionId);
      break;
    }

    if (i < MAX_SELF_REVIEW_ITERATIONS) {
      info(`Self-review found ${result.issues.length} issues — applying corrections`, current.sessionId);
      current = applyCorrections(current, result.issues);
      saveSession(current);
    } else {
      warn(`Self-review reached max iterations (${MAX_SELF_REVIEW_ITERATIONS}) — escalating to Gate 1`, current.sessionId);
    }
  }

  current = { ...current, stage: 'awaiting_approval' };
  saveSession(current);
  info(`Self-review complete — session advancing to Gate 1`, current.sessionId);
  return current;
}

async function reviewOncePlan(
  session: IssueSession,
  neurolink: NeuroLink,
  iteration: number,
): Promise<SelfReviewResult> {
  const plan = session.plan!;

  const planSummary = plan.changes.map(c =>
    `File: ${c.path}\nChange: ${c.description}\nBefore:\n${c.before}\nAfter:\n${c.after}`
  ).join('\n\n---\n\n');

  const prompt = `
You are reviewing a code fix you generated for a ${session.domain} issue: "${session.issueType}".
Root cause: ${plan.rootCause}

Review this planned fix critically. Look for:
1. Missing imports that the new code requires
2. Regressions: does the fix break other functionality?
3. Team pattern violations: does this differ from the known patterns for ${session.repoOwner}/${session.repoName}?
4. Missing test updates (flag, don't block)
5. Inconsistencies between files in the change set

Planned changes (iteration ${iteration}):
${planSummary}

Respond with JSON:
{
  "clean": boolean,
  "issues": [{ "description": string, "file": string, "suggestion": string }]
}
If clean, issues must be an empty array.
`.trim();

  const response = await neurolink.generate({
    messages: [{ role: 'user', content: prompt }],
    responseFormat: { type: 'json_object' },
  });

  try {
    const parsed = JSON.parse(response.content) as { clean: boolean; issues: SelfReviewIssue[] };
    return { clean: parsed.clean, issues: parsed.issues ?? [], iterationNumber: iteration };
  } catch {
    warn(`Self-review response was not valid JSON — treating as clean`, session.sessionId);
    return { clean: true, issues: [], iterationNumber: iteration };
  }
}

function applyCorrections(session: IssueSession, issues: SelfReviewIssue[]): IssueSession {
  if (!session.plan) return session;

  // Add correction notes to the PR body and test suggestions
  const correctionNotes = issues.map(i => `- ${i.file}: ${i.description} → ${i.suggestion}`);
  const updatedPlan = {
    ...session.plan,
    prBodyMarkdown: session.plan.prBodyMarkdown + '\n\n### Self-Review Corrections\n' + correctionNotes.join('\n'),
    testSuggestions: [
      ...session.plan.testSuggestions,
      ...issues
        .filter(i => i.description.toLowerCase().includes('test'))
        .map(i => i.suggestion),
    ],
  };

  return { ...session, plan: updatedPlan };
}
```

---

## Constants (add to `src/lib/constants.ts`)

```typescript
export const MAX_SELF_REVIEW_ITERATIONS = 3;
```

---

## Integration with Orchestrator

`runSelfReview()` is called by the agent loop after the plan is generated, before HITL:

```typescript
// In src/agent/loop.ts, after plan generation:
if (session.goalProgress >= GOAL_PROGRESS_THRESHOLD) {
  session = await advanceStage(session, 'awaiting_self_review');
  session = await runSelfReview(session, neurolink);
  // session is now 'awaiting_approval' — HITL picks it up
  return session;
}
```

---

## Fallback Behaviour

If `neurolink.generate()` throws during self-review:
- Log the error with session ID
- Treat the iteration as clean (do not block Gate 1 due to self-review failure)
- Advance to `awaiting_approval` immediately

```typescript
try {
  result = await reviewOncePlan(session, neurolink, i);
} catch (err) {
  warn(`Self-review NeuroLink call failed: ${(err as Error).message} — treating as clean`, session.sessionId);
  result = { clean: true, issues: [], iterationNumber: i };
}
```
