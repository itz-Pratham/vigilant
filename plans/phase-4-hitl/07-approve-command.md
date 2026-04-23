# Phase 4 — Approve Command

**File:** `src/cli/commands/approve.ts`

## Objective

`vigilant approve <id>` auto-approves Gate 1 without showing the interactive prompt. Intended for CI pipelines, scripts, or when the human has already reviewed via `vigilant session <id>` and wants a fast path. Gate 2 (merge) is never auto-approved — it always requires the interactive prompt or a manual GitHub merge.

---

## Implementation

```typescript
// src/cli/commands/approve.ts

import chalk               from 'chalk';
import { loadSession,
         advanceStage }    from '@/agent/stateManager';
import { info }            from '@/lib/logger';

export function runApproveCommand(sessionId: string): void {
  const session = loadSession(sessionId);

  if (!session) {
    process.stderr.write(chalk.red(`Session not found: ${sessionId}\n`));
    process.exit(1);
  }

  if (session.stage !== 'awaiting_approval') {
    process.stderr.write(
      chalk.yellow(`Session ${sessionId} is not awaiting approval (stage: ${session.stage})\n`)
    );
    process.exit(1);
  }

  advanceStage(session, 'executing');
  info(`Gate 1 approved via CLI`, session.sessionId);

  process.stdout.write(chalk.green(`✓ Approved. Session ${sessionId} is now executing.\n`));
  process.stdout.write(chalk.grey(`  The daemon will pick this up on its next cycle.\n`));
}
```

---

## CLI Registration

```typescript
// In src/cli/index.ts:
program
  .command('approve <id>')
  .description('Approve Gate 1 for a session (non-interactive, for scripts and CI)')
  .action((id) => runApproveCommand(id));
```

---

## Why Gate 2 Is Not Auto-Approvable

Gate 1 (plan approval) is safe to auto-approve because no code has been written yet — the human can still inspect the PR before it merges. Gate 2 (merge) is the final action; once merged, it cannot be undone without a revert. Auto-approve at Gate 2 would violate the HITL contract defined in `AGENT.md`.

If a team wants auto-merge, they should configure GitHub's own auto-merge on PRs matching the `vigilant/fix/` branch pattern — not bypass Gate 2 in vigilant itself.
