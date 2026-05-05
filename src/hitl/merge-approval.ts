// src/hitl/merge-approval.ts
// Gate 2 — display the PR status in a terminal box and ask the human to
// merge, review manually, or close. Calls GitHub API for merge/close.

import inquirer               from 'inquirer';
import { renderBox, renderCIStatus } from './renderer.js';
import { saveSession }               from '../db/queries/sessions.js';
import { githubRequest }             from '../lib/github.js';
import { info, warn }                from '../lib/logger.js';
import { STAGE }                     from '../lib/constants.js';
import type { IssueSession }         from '../agent/types.js';
import type { Gate2Decision }        from './types.js';

/**
 * Display Gate 2. Blocks until the human makes a decision.
 * Calls GitHub API for merge or close. Updates session stage in SQLite.
 *
 * @returns 'merged' | 'review' | 'closed'
 */
export async function gateTwo(session: IssueSession): Promise<Gate2Decision> {
  displayPRBox(session);

  const { decision } = await inquirer.prompt<{ decision: string }>([{
    type:    'list',
    name:    'decision',
    message: 'What would you like to do?',
    choices: [
      { name: '🔀 Merge — squash and merge this PR', value: 'merge' },
      { name: "👀 Review — I'll review it myself first", value: 'review' },
      { name: '❌ Close — close without merging', value: 'close' },
    ],
  }]);

  if (decision === 'merge') {
    try {
      await mergePR(session);
      session.stage = STAGE.MERGED;
      saveSession(session);
      info(`Gate 2: PR #${session.prNumber} merged for ${session.sessionId}`, 'hitl');
    } catch (err) {
      warn(`Gate 2: merge failed: ${err instanceof Error ? err.message : String(err)}`, 'hitl');
      process.stdout.write(`\n⚠️  Merge failed: ${err instanceof Error ? err.message : String(err)}\n\n`);
    }
    return 'merged';
  }

  if (decision === 'close') {
    try {
      await closePR(session);
      session.stage = STAGE.CLOSED;
      saveSession(session);
      info(`Gate 2: PR #${session.prNumber} closed for ${session.sessionId}`, 'hitl');
    } catch (err) {
      warn(`Gate 2: close failed: ${err instanceof Error ? err.message : String(err)}`, 'hitl');
    }
    return 'closed';
  }

  // 'review' — no stage change, human will handle it manually or via `vigilant approve`
  warn(`Gate 2: session ${session.sessionId} left for manual review`, 'hitl');
  return 'review';
}

// ── GitHub calls ──────────────────────────────────────────────────────────────

async function mergePR(session: IssueSession): Promise<void> {
  if (!session.prNumber) throw new Error('prNumber is not set on session');

  await githubRequest(
    (octokit) => octokit.pulls.merge({
      owner:          session.repoOwner,
      repo:           session.repoName,
      pull_number:    session.prNumber!,
      merge_method:   'squash',
      commit_title:   session.plan?.prTitle ?? `[vigilant] ${session.issueType}`,
      commit_message: `Merged by vigilant. Session: ${session.sessionId}`,
    }).then(r => r.data),
    'hitl.mergePR',
  );
}

async function closePR(session: IssueSession): Promise<void> {
  if (!session.prNumber) throw new Error('prNumber is not set on session');

  await githubRequest(
    (octokit) => octokit.pulls.update({
      owner:       session.repoOwner,
      repo:        session.repoName,
      pull_number: session.prNumber!,
      state:       'closed',
    }).then(r => r.data),
    'hitl.closePR',
  );
}

// ── Display ───────────────────────────────────────────────────────────────────

function displayPRBox(session: IssueSession): void {
  const ciLine  = renderCIStatus(session.ciStatus);
  const prTitle = session.plan?.prTitle ?? '(no title)';
  const prUrl   = session.prUrl         ?? '(no URL)';

  const box = renderBox(
    `vigilant  ·  PR READY  ·  ${session.sessionId.slice(-20)}`,
    [
      {
        lines: [
          `PR #${session.prNumber ?? '?'}   ${prTitle}`,
          `CI      ${ciLine}`,
          `Link    ${prUrl}`,
        ],
      },
      { lines: ['🔀 Merge   👀 Review first   ❌ Close'] },
    ],
    session.severity,
  );

  process.stdout.write('\n' + box + '\n\n');
}
