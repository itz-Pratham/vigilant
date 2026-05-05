// src/hitl/plan-approval.ts
// Gate 1 — display the fix plan in a terminal box and ask the human to
// approve, modify, or skip. Returns the final Gate1Decision.

import inquirer               from 'inquirer';
import { renderBox, renderPlanLines } from './renderer.js';
import { saveSession }                from '../db/queries/sessions.js';
import { generatePlan }               from '../agent/plan-generator.js';
import { info }                       from '../lib/logger.js';
import { STAGE }                      from '../lib/constants.js';
import type { IssueSession }          from '../agent/types.js';
import type { DomainPack }            from '../agent/domain-context.js';
import type { VigilantConfig }        from '../config/types.js';
import type { Gate1Decision }         from './types.js';

const MAX_MODIFY_ATTEMPTS = 3;

/**
 * Display Gate 1. Blocks until the human makes a decision.
 * Advances session stage in SQLite before returning.
 *
 * @returns 'approved' | 'skipped'
 */
export async function gateOne(
  session:  IssueSession,
  pack:     DomainPack,
  config:   VigilantConfig,
  modifyAttempts = 0,
): Promise<Gate1Decision> {
  if (!session.plan) {
    info(`Gate 1: no plan for ${session.sessionId} — skipping`, 'hitl');
    session.stage = STAGE.SKIPPED;
    saveSession(session);
    return 'skipped';
  }

  displayPlanBox(session);

  const { decision } = await inquirer.prompt<{ decision: string }>([{
    type:    'list',
    name:    'decision',
    message: 'What would you like to do?',
    choices: [
      { name: '✅ Approve — execute this plan', value: 'approve' },
      { name: '✏️  Modify — edit instructions, re-generate', value: 'modify' },
      { name: '⏭️  Skip — ignore this issue', value: 'skip' },
    ],
  }]);

  if (decision === 'approve') {
    session.stage = STAGE.EXECUTING;
    saveSession(session);
    info(`Gate 1 approved for ${session.sessionId}`, 'hitl');
    return 'approved';
  }

  if (decision === 'skip') {
    session.stage = STAGE.SKIPPED;
    saveSession(session);
    info(`Gate 1 skipped for ${session.sessionId}`, 'hitl');
    return 'skipped';
  }

  // ── Modify flow ────────────────────────────────────────────────────────────
  if (modifyAttempts >= MAX_MODIFY_ATTEMPTS) {
    process.stdout.write(`\nMax modify attempts (${MAX_MODIFY_ATTEMPTS}) reached — approving as-is.\n\n`);
    session.stage = STAGE.EXECUTING;
    saveSession(session);
    return 'approved';
  }

  const { instructions } = await inquirer.prompt<{ instructions: string }>([{
    type:    'input',
    name:    'instructions',
    message: 'Describe what should change in the plan:',
    default: buildModifyDefault(session),
    validate: (v: string) => v.trim().length > 0 || 'Instructions cannot be empty',
  }]);

  info(`Re-generating plan with human instructions for ${session.sessionId}`, 'hitl');
  session.dataCollected = { ...session.dataCollected, humanModifyInstructions: instructions };

  try {
    await generatePlan(session, pack, config);
  } catch (err) {
    process.stdout.write(`\n⚠️  Plan re-generation failed: ${err instanceof Error ? err.message : String(err)}\n\n`);
  }

  // Recurse — re-display the updated plan and re-prompt
  return gateOne(session, pack, config, modifyAttempts + 1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function displayPlanBox(session: IssueSession): void {
  const plan = session.plan!;

  const metaLines = [
    `ISSUE   ${session.issueType.replace(/_/g, ' ')}`,
    `SOURCE  ${session.sourceRef}`,
    `DOMAIN  ${session.domain}`,
    `RISK    ${plan.rootCause.split('.')[0]}`,
  ];

  const planLines = renderPlanLines(plan.changes);

  const branchLines = [
    `Branch  ${plan.branchName}`,
    `PR      ${plan.prTitle}`,
    `Tests   ${plan.testSuggestions.length} suggestion(s)`,
  ];

  const title = `vigilant  ·  ${session.severity}  ·  ${session.sessionId.slice(-20)}`;

  const box = renderBox(
    title,
    [
      { lines: metaLines },
      { heading: 'PLAN', lines: planLines.length > 0 ? planLines : ['(no file changes)'] },
      { lines: branchLines },
      { lines: ['✅ Approve   ✏️  Modify   ⏭️  Skip'] },
    ],
    session.severity,
  );

  process.stdout.write('\n' + box + '\n\n');
}

function buildModifyDefault(session: IssueSession): string {
  const plan = session.plan!;
  return [
    `Fix: ${plan.summary}`,
    `Files: ${plan.changes.map(c => c.path).join(', ')}`,
    'Instructions: ',
  ].join(' | ');
}
