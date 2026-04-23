# Phase 4 — Gate 1 (Plan Approval)

**File:** `src/hitl/plan-approval.ts`

## Objective

Render the plan in a terminal box and prompt the human for one of three decisions: approve, modify, or skip. If modify is chosen, re-generate the plan with the human's instructions, then loop back and re-display. Returns the final decision.

---

## Implementation

```typescript
// src/hitl/plan-approval.ts

import inquirer  from 'inquirer';
import { renderBox, renderPlanLines } from './renderer';
import { advanceStage }               from '@/agent/stateManager';
import { generatePlan }               from '@/agent/planGenerator';
import { info }                        from '@/lib/logger';
import type { IssueSession }           from '@/agent/types';
import type { Gate1Decision }          from './types';
import type { DomainPack }             from '@/agent/domainContext';
import type { VigilantConfig }         from '@/config/types';

/**
 * Display Gate 1. Blocks until the human makes a decision.
 * Updates session stage in SQLite before returning.
 *
 * @returns 'approved' | 'modified' (plan re-generated, then approved) | 'skipped'
 */
export async function gateOne(
  session: IssueSession,
  pack: DomainPack,
  config: VigilantConfig,
): Promise<Gate1Decision> {
  displayPlanBox(session);

  const { decision } = await inquirer.prompt<{ decision: string }>([{
    type:    'list',
    name:    'decision',
    message: 'What would you like to do?',
    choices: [
      { name: 'Approve — execute this plan', value: 'approve' },
      { name: 'Modify — edit instructions, re-generate', value: 'modify' },
      { name: 'Skip — ignore this issue', value: 'skip' },
    ],
  }]);

  if (decision === 'approve') {
    advanceStage(session, 'executing');
    info(`Gate 1 approved`, session.sessionId);
    return 'approved';
  }

  if (decision === 'skip') {
    advanceStage(session, 'skipped');
    info(`Gate 1 skipped`, session.sessionId);
    return 'skipped';
  }

  // ── Modify flow ──────────────────────────────────────────────────────────
  const { instructions } = await inquirer.prompt<{ instructions: string }>([{
    type:    'editor',
    name:    'instructions',
    message: 'Describe what should change in the plan (saved when you close the editor):',
    default: buildModifyDefault(session),
  }]);

  info(`Re-generating plan with human instructions`, session.sessionId);
  session.dataCollected = { ...session.dataCollected, humanModifyInstructions: instructions };
  session.plan = await generatePlan(session, pack);

  // Recurse — re-display the updated plan and re-prompt
  return gateOne(session, pack, config);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function displayPlanBox(session: IssueSession): void {
  const plan = session.plan!;

  const metaLines = [
    `ISSUE   ${plan.title}`,
    `SOURCE  ${session.sourceRef}`,
    `DOMAIN  ${session.domain}`,
    `RISK    ${plan.riskSummary}`,
  ];

  const planLines = renderPlanLines(plan.fileChanges);

  const branchLines = [
    `Branch  ${plan.branchName}`,
    `PR      ${plan.prTitle}`,
  ];

  const title = `vigilant  ·  ${session.severity}  ·  ${session.sessionId}`;

  const box = renderBox(
    title,
    [
      { lines: metaLines },
      { heading: 'PLAN', lines: planLines },
      { lines: branchLines },
      { lines: ['[a] Approve   [m] Modify plan   [s] Skip'] },
    ],
    session.severity,
  );

  process.stdout.write('\n' + box + '\n\n');
}

function buildModifyDefault(session: IssueSession): string {
  const plan = session.plan!;
  return [
    `Current plan: ${plan.title}`,
    '',
    'Files to change:',
    ...plan.fileChanges.map((c, i) => `  ${i + 1}. ${c.path} — ${c.description}`),
    '',
    'Your instructions for changes to this plan:',
    '(Replace this text with your modifications)',
  ].join('\n');
}
```
