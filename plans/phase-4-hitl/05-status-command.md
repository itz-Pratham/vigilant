# Phase 4 — Status Command

**File:** `src/cli/commands/status.ts`

## Objective

`vigilant status` prints a table of all sessions — active and recently terminal — so the human can see at a glance what vigilant is doing and what needs their attention.

---

## GitHub API Used

None. Reads entirely from local SQLite `state.db`.

---

## Implementation

```typescript
// src/cli/commands/status.ts

import Table     from 'cli-table3';
import chalk     from 'chalk';
import { formatDistanceToNow } from 'date-fns';
import { getStateDb }          from '@/db';
import { TERMINAL_STAGES }     from '@/lib/constants';
import type { IssueSession }   from '@/agent/types';

type SessionRow = {
  session_id: string; stage: string; severity: string;
  domain: string; issue_type: string; updated_at: string;
  pr_number: number | null; blocker_reason: string | null;
};

const STAGE_COLOUR: Record<string, (s: string) => string> = {
  discovered:        chalk.grey,
  investigating:     chalk.blue,
  planning:          chalk.blue,
  awaiting_approval: chalk.yellow.bold,
  executing:         chalk.cyan,
  pr_created:        chalk.cyan,
  awaiting_merge:    chalk.yellow.bold,
  merged:            chalk.green,
  skipped:           chalk.grey,
  closed:            chalk.grey,
  blocked:           chalk.red.bold,
};

export function runStatusCommand(options: { all?: boolean }): void {
  const db   = getStateDb();
  const rows = (options.all
    ? db.prepare('SELECT * FROM agent_sessions ORDER BY updated_at DESC').all()
    : db.prepare(`
        SELECT * FROM agent_sessions
        WHERE stage NOT IN (${TERMINAL_STAGES.map(() => '?').join(',')})
           OR updated_at > datetime('now', '-24 hours')
        ORDER BY updated_at DESC
      `).all(...TERMINAL_STAGES)
  ) as SessionRow[];

  if (rows.length === 0) {
    process.stdout.write(chalk.grey('No sessions found. Run `vigilant start --repo org/repo` to begin.\n'));
    return;
  }

  const table = new Table({
    head: ['SESSION ID', 'STAGE', 'SEV', 'DOMAIN', 'UPDATED'].map(h => chalk.white.bold(h)),
    style: { border: ['grey'], head: [] },
    colWidths: [48, 20, 10, 14, 12],
  });

  for (const row of rows) {
    const stageColour = STAGE_COLOUR[row.stage] ?? chalk.white;
    const sevColour   = row.severity === 'CRITICAL' ? chalk.red.bold
      : row.severity === 'HIGH'     ? chalk.yellow
      : row.severity === 'MEDIUM'   ? chalk.cyan
      : chalk.grey;

    const timeAgo = formatDistanceToNow(new Date(row.updated_at), { addSuffix: true });
    const blocker = row.blocker_reason ? chalk.red(` ⚠ ${row.blocker_reason.split(':')[0]}`) : '';

    table.push([
      chalk.grey(row.session_id),
      stageColour(row.stage) + blocker,
      sevColour(row.severity),
      row.domain,
      chalk.grey(timeAgo),
    ]);
  }

  process.stdout.write('\n' + table.toString() + '\n\n');

  const needsAction = rows.filter(r => r.stage === 'awaiting_approval' || r.stage === 'awaiting_merge');
  if (needsAction.length > 0) {
    process.stdout.write(
      chalk.yellow.bold(`⚡ ${needsAction.length} session(s) need your attention.\n`) +
      chalk.grey(`   Run \`vigilant session <id>\` to review and approve.\n\n`),
    );
  }
}
```

---

## CLI Registration

```typescript
// In src/cli/index.ts:
program
  .command('status')
  .description('Show all active sessions and their current stage')
  .option('--all', 'Include merged/skipped/closed sessions from the last 7 days')
  .action((opts) => runStatusCommand(opts));
```
