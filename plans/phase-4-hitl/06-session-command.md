# Phase 4 — Session Command

**File:** `src/cli/commands/session.ts`

## Objective

`vigilant session <id>` shows full detail for one session — issue context, plan (if generated), PR link, CI status, and blocker reason. If the session is at a gate, it triggers the appropriate gate prompt inline.

---

## Implementation

```typescript
// src/cli/commands/session.ts

import chalk                   from 'chalk';
import { formatDistanceToNow } from 'date-fns';
import { loadSession }         from '@/agent/stateManager';
import { loadActiveDomainPacks,
         findPackForIssueType } from '@/agent/domainContext';
import { gateOne }             from '@/hitl/plan-approval';
import { gateTwo }             from '@/hitl/merge-approval';
import { loadConfig }          from '@/config';
import { info }                from '@/lib/logger';

export async function runSessionCommand(sessionId: string): Promise<void> {
  const session = loadSession(sessionId);

  if (!session) {
    process.stderr.write(chalk.red(`Session not found: ${sessionId}\n`));
    process.exit(1);
  }

  printSessionDetail(session);

  // If the session is at a gate, offer to run the prompt immediately
  if (session.stage === 'awaiting_approval') {
    const config      = loadConfig();
    const packs       = loadActiveDomainPacks(config);
    const pack        = findPackForIssueType(packs, session.issueType);
    if (pack) await gateOne(session, pack, config);
  }

  if (session.stage === 'awaiting_merge') {
    await gateTwo(session);
  }
}

// ── Detail Renderer ──────────────────────────────────────────────────────────

function printSessionDetail(session: IssueSession): void {
  const timeAgo = formatDistanceToNow(new Date(session.updatedAt), { addSuffix: true });

  const lines = [
    `${chalk.white.bold('Session')}  ${chalk.grey(session.sessionId)}`,
    `${chalk.white.bold('Stage')}    ${stageColour(session.stage)(session.stage)}`,
    `${chalk.white.bold('Severity')} ${session.severity}`,
    `${chalk.white.bold('Domain')}   ${session.domain}`,
    `${chalk.white.bold('Issue')}    ${session.issueType}`,
    `${chalk.white.bold('Source')}   ${session.sourceRef}`,
    `${chalk.white.bold('Updated')}  ${timeAgo}`,
  ];

  if (session.blockerReason) {
    lines.push(`${chalk.red.bold('Blocker')}  ${session.blockerReason}`);
  }

  if (session.keyFindings.length > 0) {
    lines.push('');
    lines.push(chalk.white.bold('Key findings:'));
    session.keyFindings.forEach((f, i) => lines.push(`  ${i + 1}. ${f}`));
  }

  if (session.plan) {
    lines.push('');
    lines.push(chalk.white.bold('Plan:'));
    lines.push(`  Title:  ${session.plan.title}`);
    lines.push(`  Risk:   ${session.plan.riskSummary}`);
    lines.push(`  Branch: ${session.plan.branchName}`);
    lines.push('  Changes:');
    session.plan.fileChanges.forEach((c, i) => {
      lines.push(`    ${i + 1}. ${c.path} — ${c.description}`);
    });
  }

  if (session.prUrl) {
    lines.push('');
    lines.push(chalk.white.bold('PR:'));
    lines.push(`  ${session.prUrl}`);
    lines.push(`  CI: ${session.ciStatus ?? 'pending'}`);
  }

  process.stdout.write('\n' + lines.join('\n') + '\n\n');
}

function stageColour(stage: string): (s: string) => string {
  if (['awaiting_approval', 'awaiting_merge'].includes(stage)) return chalk.yellow.bold;
  if (stage === 'blocked') return chalk.red.bold;
  if (['merged', 'skipped', 'closed'].includes(stage)) return chalk.grey;
  return chalk.cyan;
}
```

---

## CLI Registration

```typescript
// In src/cli/index.ts:
program
  .command('session <id>')
  .description('Show full detail for a session, and trigger its gate if pending')
  .action((id) => runSessionCommand(id));
```
