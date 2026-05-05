// src/cli/commands/approve.ts
// Programmatic Gate 1 approval from a second terminal or CI pipeline.
// No interactive prompt — just advances the session stage directly.

import chalk           from 'chalk';
import { getSession, saveSession } from '../../db/queries/sessions.js';
import { STAGE }       from '../../lib/constants.js';

export async function approvePlan(sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session) {
    process.stdout.write(chalk.red(`\n  Session not found: ${sessionId}\n\n`));
    process.exit(1);
  }

  if (session.stage === 'awaiting_approval') {
    session.stage = STAGE.EXECUTING;
    saveSession(session);
    process.stdout.write(chalk.green(`\n  ✅ Session ${sessionId} approved — executor will run shortly.\n\n`));
    return;
  }

  if (session.stage === 'awaiting_merge') {
    process.stdout.write(chalk.yellow(
      `\n  Session ${sessionId} is at Gate 2 (awaiting merge).\n` +
      `  Run \`vigilant session ${sessionId}\` to merge interactively.\n\n`,
    ));
    return;
  }

  process.stdout.write(chalk.yellow(
    `\n  Session ${sessionId} is not awaiting approval (current stage: ${session.stage}).\n\n`,
  ));
}
