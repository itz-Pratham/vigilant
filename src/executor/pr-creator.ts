// src/executor/pr-creator.ts
// Creates a GitHub PR with a structured body from the session plan.
// Recovers gracefully if a PR already exists (crash-restart scenario).

import { githubRequest } from '../lib/github.js';
import { info }          from '../lib/logger.js';
import { ExecutorError } from '../lib/errors.js';
import type { IssueSession } from '../agent/types.js';
import type { ExecutorContext } from './types.js';

const SEVERITY_EMOJI: Record<string, string> = {
  CRITICAL: '🔴',
  HIGH:     '🟠',
  MEDIUM:   '🟡',
  LOW:      '🟢',
};

function buildPRBody(session: IssueSession): string {
  const { plan, issueType, domain, severity, sessionId } = session;
  if (!plan) throw new Error('No plan on session');

  const emoji   = SEVERITY_EMOJI[severity] ?? '⚪';
  const changes = plan.changes.map(c => `- **\`${c.path}\`**: ${c.description}`).join('\n');
  const tests   = plan.testSuggestions.length > 0
    ? plan.testSuggestions.map(t => `- ${t}`).join('\n')
    : '_No test suggestions._';

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
 * Creates a PR for the branch. Returns PR number, URL, and head SHA.
 * If a PR already exists for the branch (crash recovery), returns that PR instead.
 * Throws `ExecutorError` with step='pr' on unrecoverable failure.
 */
export async function createPR(
  session: IssueSession,
  ctx:     ExecutorContext,
): Promise<{ prNumber: number; prUrl: string; prHeadSha: string }> {
  if (!session.plan) {
    throw new ExecutorError('No plan on session', 'pr', session.sessionId);
  }

  // Crash recovery: check if a PR already exists for this branch
  try {
    const existing = await githubRequest(
      (octokit) => octokit.pulls.list({
        owner:    ctx.owner,
        repo:     ctx.repo,
        head:     `${ctx.owner}:${ctx.branchName}`,
        state:    'open',
        per_page: 1,
      }).then(r => r.data),
      'executor',
    );

    if (existing.length > 0) {
      const pr = existing[0]!;
      info(`PR #${pr.number} already exists for branch ${ctx.branchName} — reusing`, 'executor');
      return { prNumber: pr.number, prUrl: pr.html_url, prHeadSha: pr.head.sha };
    }
  } catch {
    // If the check fails, continue to create a new PR
  }

  const title = `fix(${session.issueType.toLowerCase()}): ${session.plan.summary} [vigilant]`;

  try {
    const pr = await githubRequest(
      (octokit) => octokit.pulls.create({
        owner: ctx.owner,
        repo:  ctx.repo,
        title,
        body:  buildPRBody(session),
        head:  ctx.branchName,
        base:  ctx.defaultBranch,
      }).then(r => r.data),
      'executor',
    );

    info(`Opened PR #${pr.number}: ${title}`, 'executor');

    // Add labels — fully non-fatal (labels may not exist in the repo)
    const labels = ['vigilant', `domain:${session.domain}`, `severity:${session.severity.toLowerCase()}`];
    void (async () => {
      try {
        await githubRequest(
          (octokit) => octokit.issues.addLabels({
            owner:        ctx.owner,
            repo:         ctx.repo,
            issue_number: pr.number,
            labels,
          }).then(r => r.data),
          'executor',
        );
      } catch { /* non-fatal */ }
    })();

    return { prNumber: pr.number, prUrl: pr.html_url, prHeadSha: pr.head.sha };
  } catch (err: unknown) {
    throw new ExecutorError(
      `PR creation failed: ${err instanceof Error ? err.message : String(err)}`,
      'pr',
      session.sessionId,
    );
  }
}
