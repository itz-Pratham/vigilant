# Phase 5 — PR Creator

**File:** `src/executor/pr-creator.ts`

## Objective

Create a well-structured GitHub PR with the session context, root-cause, file changes, and test suggestions in the body. The PR body is the human-readable summary of everything vigilant found and fixed.

---

## Implementation

```typescript
// src/executor/pr-creator.ts
import { Octokit }       from '@octokit/rest';
import { IssueSession }  from '../types.js';
import { ExecutorContext } from './types.js';

const SEVERITY_EMOJI: Record<string, string> = {
  CRITICAL: '🔴',
  HIGH:     '🟠',
  MEDIUM:   '🟡',
  LOW:      '🟢',
};

function buildPRBody(session: IssueSession): string {
  const { plan, issueType, domain, severity, sessionId } = session;
  if (!plan) throw new Error('No plan on session');

  const emoji    = SEVERITY_EMOJI[severity] ?? '⚪';
  const changes  = plan.changes.map(c => `- **\`${c.path}\`**: ${c.description}`).join('\n');
  const tests    = plan.testSuggestions.map(t => `- ${t}`).join('\n');

  return `## ${emoji} ${plan.summary}

### Root Cause
${plan.rootCause}

### Changes Made
${changes}

### Test Suggestions
${tests}

---
<details>
<summary>vigilant session info</summary>

| Field        | Value |
|---|---|
| Session ID   | \`${sessionId}\` |
| Domain       | ${domain} |
| Issue type   | \`${issueType}\` |
| Severity     | ${severity} |

</details>

*Opened by [vigilant](https://github.com/itz-Pratham/vigilant) · auto-fix · requires human review*`;
}

/**
 * Creates a PR and returns its number and URL.
 * Throws ExecutorError on API failure.
 */
export async function createPR(
  octokit:      Octokit,
  session:      IssueSession,
  ctx:          ExecutorContext,
  defaultBranch: string,
): Promise<{ prNumber: number; prUrl: string; prSha: string }> {
  const { plan, issueType } = session;
  if (!plan) throw new Error('No plan on session');

  const title = `fix(${issueType.toLowerCase()}): ${plan.summary} [vigilant]`;

  const { data: pr } = await octokit.pulls.create({
    owner: ctx.owner,
    repo:  ctx.repo,
    title,
    body:  buildPRBody(session),
    head:  ctx.branchName,
    base:  defaultBranch,
  });

  return {
    prNumber: pr.number,
    prUrl:    pr.html_url,
    prSha:    pr.head.sha,
  };
}
```

---

## PR Title Convention

```
fix({issueType_lower_snake}): {plan.summary} [vigilant]
```

**Examples:**
```
fix(missing_idempotency): Add idempotency key to createPayment() [vigilant]
fix(webhook_no_signature): Verify HMAC-SHA256 on webhook handler [vigilant]
fix(secret_in_code): Remove hardcoded API key, load from environment [vigilant]
```

---

## PR Labels

After creating the PR, vigilant attempts to add labels. Label creation is idempotent — if labels don't exist in the repo, they are created:

```typescript
const labels = ['vigilant', `domain:${session.domain}`, `severity:${session.severity.toLowerCase()}`];

try {
  await octokit.issues.addLabels({
    owner: ctx.owner,
    repo:  ctx.repo,
    issue_number: prNumber,
    labels,
  });
} catch {
  // Label creation failure is non-fatal — PR still opens
}
```

---

## Already-Open PR Recovery

If a PR for this branch already exists (restart case), resolve it without creating a new one:
```typescript
const existing = await octokit.pulls.list({
  owner: ctx.owner, repo: ctx.repo,
  head:  `${ctx.owner}:${ctx.branchName}`,
  state: 'open',
});
if (existing.data.length > 0) {
  const pr = existing.data[0];
  return { prNumber: pr.number, prUrl: pr.html_url, prSha: pr.head.sha };
}
```
