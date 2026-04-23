# Phase 4 — Gate 2 (Merge Approval)

**File:** `src/hitl/merge-approval.ts`

## Objective

Render the PR status box and prompt the human to merge, review manually, or close. Calling the GitHub merge API is done here — the executor does not merge. Returns the final decision.

---

## GitHub API Used

```
PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge
  body: { merge_method: 'squash', commit_title: '{prTitle}' }

PATCH /repos/{owner}/{repo}/pulls/{pull_number}
  body: { state: 'closed' }   ← used on 'close' decision
```

---

## Implementation

```typescript
// src/hitl/merge-approval.ts

import inquirer from 'inquirer';
import { renderBox, renderCIStatus } from './renderer';
import { advanceStage }              from '@/agent/stateManager';
import { githubRequest }             from '@/lib/github';
import { info, warn }                from '@/lib/logger';
import type { IssueSession }         from '@/agent/types';
import type { Gate2Decision }        from './types';

/**
 * Display Gate 2. Blocks until the human makes a decision.
 * Calls GitHub API for merge or close. Updates session stage in SQLite.
 */
export async function gateTwo(session: IssueSession): Promise<Gate2Decision> {
  displayPRBox(session);

  const { decision } = await inquirer.prompt<{ decision: string }>([{
    type:    'list',
    name:    'decision',
    message: 'What would you like to do?',
    choices: [
      { name: 'Merge — squash and merge this PR', value: 'merge' },
      { name: "Review — I'll review it myself first", value: 'review' },
      { name: 'Close — close without merging', value: 'close' },
    ],
  }]);

  if (decision === 'merge') {
    await mergePR(session);
    advanceStage(session, 'merged');
    info(`Gate 2: PR merged`, session.sessionId);
    return 'merged';
  }

  if (decision === 'close') {
    await closePR(session);
    advanceStage(session, 'closed');
    info(`Gate 2: PR closed`, session.sessionId);
    return 'closed';
  }

  // 'review' — no stage change, human will handle it manually
  warn(`Gate 2: marked for manual review`, session.sessionId);
  return 'review';
}

// ── GitHub calls ─────────────────────────────────────────────────────────────

async function mergeRP(session: IssueSession): Promise<void> {
  await githubRequest(`/repos/${session.repoOwner}/${session.repoName}/pulls/${session.prNumber}/merge`, {
    method: 'PUT',
    data: {
      merge_method:   'squash',
      commit_title:   session.plan?.prTitle ?? `fix: vigilant auto-fix [${session.sessionId}]`,
      commit_message: `Merged by vigilant. Session: ${session.sessionId}`,
    },
  });
}

async function closePR(session: IssueSession): Promise<void> {
  await githubRequest(`/repos/${session.repoOwner}/${session.repoName}/pulls/${session.prNumber}`, {
    method: 'PATCH',
    data: { state: 'closed' },
  });
}

// ── Display ──────────────────────────────────────────────────────────────────

function displayPRBox(session: IssueSession): void {
  const ciLine   = renderCIStatus(session.ciStatus, 0, 0);
  const prTitle  = session.plan?.prTitle ?? '(no title)';
  const prUrl    = session.prUrl ?? '(no URL)';

  const box = renderBox(
    `vigilant  ·  PR READY  ·  ${session.sessionId}`,
    [
      {
        lines: [
          `PR #${session.prNumber}   ${prTitle}`,
          `CI      ${ciLine}`,
          `Link    ${prUrl}`,
        ],
      },
      { lines: ['[m] Merge   [r] I\'ll review first   [c] Close'] },
    ],
    session.severity,
  );

  process.stdout.write('\n' + box + '\n\n');
}
```

---

## Note on `'review'` Decision

When the human picks "review", vigilant does nothing — session stays at `awaiting_merge`. On the next `vigilant status` run, the session still appears. The human can later run `vigilant approve <id>` to trigger the merge programmatically, or merge the PR manually on GitHub (in which case the CI monitor in Phase 5 detects the merge and advances the session to `merged`).
