// src/cli/commands/status.ts

import chalk                   from 'chalk';
import Table                   from 'cli-table3';
import { formatDistanceToNow } from 'date-fns';
import { listAllSessions, listSessions } from '../../db/queries/sessions.js';
import { TERMINAL_STAGES }     from '../../lib/constants.js';

const STAGE_COLOUR: Record<string, (s: string) => string> = {
  discovered:           chalk.grey,
  investigating:        chalk.blue,
  planning:             chalk.blue,
  awaiting_approval:    chalk.yellow.bold,
  executing:            chalk.cyan,
  pr_created:           chalk.cyan,
  awaiting_merge:       chalk.yellow.bold,
  self_reviewing:       chalk.cyan,
  awaiting_self_review: chalk.cyan,
  merged:               chalk.green,
  skipped:              chalk.grey,
  closed:               chalk.grey,
  blocked:              chalk.red.bold,
};

export async function showStatus(opts: { repo?: string; all?: boolean }): Promise<void> {
  const all = opts.all ?? false;

  let sessions = opts.repo
    ? (() => {
        const [owner, name] = (opts.repo ?? '').split('/');
        return owner && name ? listSessions(owner, name) : listAllSessions();
      })()
    : listAllSessions();

  if (!all) {
    const terminalSet = new Set<string>(TERMINAL_STAGES);
    const cutoff      = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    sessions = sessions.filter(
      s => !terminalSet.has(s.stage) || s.updatedAt >= cutoff,
    );
  }

  if (sessions.length === 0) {
    process.stdout.write(chalk.grey('\n  No sessions found. Start the daemon with: vigilant start -r owner/repo\n\n'));
    return;
  }

  const table = new Table({
    head:      ['SESSION ID', 'STAGE', 'SEV', 'DOMAIN', 'UPDATED'].map(h => chalk.white.bold(h)),
    style:     { border: ['grey'], head: [] },
    colWidths: [50, 22, 10, 14, 14],
  });

  for (const s of sessions) {
    const stageColour = STAGE_COLOUR[s.stage] ?? chalk.white;
    const sevColour =
      s.severity === 'CRITICAL' ? chalk.red.bold  :
      s.severity === 'HIGH'     ? chalk.yellow     :
      s.severity === 'MEDIUM'   ? chalk.cyan       :
                                  chalk.grey;

    const blocker = s.blockerReason
      ? chalk.red(` ⚠ ${s.blockerReason.split(':')[0]}`)
      : '';

    let timeAgo = '';
    try { timeAgo = formatDistanceToNow(new Date(s.updatedAt), { addSuffix: true }); } catch { timeAgo = '—'; }

    table.push([
      chalk.dim(s.sessionId),
      stageColour(s.stage) + blocker,
      sevColour(s.severity),
      s.domain,
      chalk.grey(timeAgo),
    ]);
  }

  process.stdout.write('\n' + table.toString() + '\n');

  const needsAction = sessions.filter(
    s => s.stage === 'awaiting_approval' || s.stage === 'awaiting_merge',
  );
  if (needsAction.length > 0) {
    process.stdout.write(
      '\n' + chalk.yellow.bold(`⚡ ${needsAction.length} session(s) awaiting your decision.\n`) +
      chalk.grey(`   Run \`vigilant session <id>\` to review.\n\n`),
    );
  } else {
    process.stdout.write('\n');
  }
}
