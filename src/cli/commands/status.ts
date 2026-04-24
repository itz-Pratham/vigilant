// src/cli/commands/status.ts

import chalk from 'chalk';
import { listAllSessions, listSessions } from '../../db/queries/sessions.js';

export async function showStatus(opts: { repo?: string; all?: boolean }): Promise<void> {
  const sessions = opts.repo
    ? (() => {
        const [owner, name] = (opts.repo).split('/');
        return owner && name ? listSessions(owner, name) : listAllSessions();
      })()
    : listAllSessions();

  if (sessions.length === 0) {
    console.log(chalk.dim('\n  No sessions found. Start the daemon with: vigilant start <owner/repo>\n'));
    return;
  }

  console.log('');

  for (const s of sessions) {
    const stageColour =
      s.stage === 'merged'      ? chalk.green  :
      s.stage === 'blocked'     ? chalk.red    :
      s.stage === 'skipped'     ? chalk.dim    :
      s.stage === 'closed'      ? chalk.dim    :
      s.stage.includes('await') ? chalk.yellow :
                                  chalk.cyan;

    const severityColour =
      s.severity === 'CRITICAL' ? chalk.red.bold :
      s.severity === 'HIGH'     ? chalk.red      :
      s.severity === 'MEDIUM'   ? chalk.yellow   :
                                  chalk.dim;

    console.log(
      `  ${chalk.bold(s.sessionId.slice(0, 8))}  ` +
      `${severityColour(s.severity.padEnd(8))}  ` +
      `${stageColour(s.stage.padEnd(22))}  ` +
      `${chalk.dim(s.issueType.padEnd(30))}  ` +
      `${chalk.dim(`${s.repoOwner}/${s.repoName}`)}`,
    );
  }

  console.log('');
}
