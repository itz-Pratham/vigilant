// src/cli/commands/session.ts
// Inspect a session in detail. If it's at a gate, display the gate prompt.

import chalk             from 'chalk';
import { getSession }    from '../../db/queries/sessions.js';
import { gateOne, gateTwo } from '../../hitl/index.js';
import { loadConfig }    from '../../config/index.js';
import { resolveActivePacks, findPackForIssueType } from '../../agent/domain-context.js';

export async function showSession(sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session) {
    process.stdout.write(chalk.red(`\n  Session not found: ${sessionId}\n\n`));
    process.exit(1);
  }

  // Print full session detail
  process.stdout.write('\n');
  process.stdout.write(chalk.bold(`Session: ${session.sessionId}\n`));
  process.stdout.write(`  Stage:      ${session.stage}\n`);
  process.stdout.write(`  Severity:   ${session.severity}\n`);
  process.stdout.write(`  Domain:     ${session.domain}\n`);
  process.stdout.write(`  Issue:      ${session.issueType}\n`);
  process.stdout.write(`  Repo:       ${session.repoOwner}/${session.repoName}\n`);
  process.stdout.write(`  Source:     ${session.sourceRef}\n`);
  process.stdout.write(`  Progress:   ${(session.goalProgress * 100).toFixed(0)}%\n`);
  process.stdout.write(`  Iterations: ${session.iterationCount}\n`);
  if (session.branchName) process.stdout.write(`  Branch:     ${session.branchName}\n`);
  if (session.prNumber)   process.stdout.write(`  PR:         #${session.prNumber} — ${session.prUrl ?? ''}\n`);
  if (session.blockerReason) process.stdout.write(chalk.red(`  Blocker:    ${session.blockerReason}\n`));

  if (session.keyFindings.length > 0) {
    process.stdout.write(`\n  Key findings:\n`);
    session.keyFindings.forEach(f => process.stdout.write(`    · ${f}\n`));
  }
  process.stdout.write('\n');

  // Trigger gate prompt if session is waiting for human input
  if (session.stage === 'awaiting_approval') {
    const config  = loadConfig();
    const packs   = resolveActivePacks(config);
    const pack    = packs.find(p => p.id === session.domain)
      ?? findPackForIssueType(session.issueType)
      ?? packs[0];
    if (pack) {
      await gateOne(session, pack, config);
    } else {
      process.stdout.write(chalk.red('  No domain pack found — cannot display Gate 1\n\n'));
    }
    return;
  }

  if (session.stage === 'awaiting_merge') {
    await gateTwo(session);
  }
}
