// src/cli/index.ts

import { Command } from 'commander';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg     = require('../../package.json') as { version: string };

export const program = new Command();

program
  .name('vigilant')
  .description('Autonomous code intelligence daemon — watches your repo, finds issues, fixes them.')
  .version(pkg.version);

// ── init ──────────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('First-time setup wizard. Creates ~/.vigilant/config.json and initialises databases.')
  .action(async () => {
    const { runInitWizard } = await import('../config/init.js');
    await runInitWizard();
  });

// ── start ─────────────────────────────────────────────────────────────────────
program
  .command('start')
  .description('Start the vigilant daemon for a repository.')
  .requiredOption('-r, --repo <owner/repo>', 'GitHub repository to watch (e.g. myorg/myrepo)')
  .option('-d, --domain <domain>', 'Domain pack override. (payments|security|reliability|compliance)')
  .option('-i, --interval <seconds>', 'Watcher tick interval in seconds. Min 30.')
  .action(async (opts) => {
    const { startDaemon } = await import('../watcher/index.js');
    await startDaemon(opts as { repo: string; domain?: string; interval?: string });
  });

// ── status ────────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show all active vigilant sessions and their current stage.')
  .option('-r, --repo <owner/repo>', 'Filter by repository')
  .option('--all', 'Include completed sessions (merged, skipped, closed)')
  .action(async (opts) => {
    const { showStatus } = await import('./commands/status.js');
    await showStatus(opts as { repo?: string; all?: boolean });
  });

// ── session ───────────────────────────────────────────────────────────────────
program
  .command('session <sessionId>')
  .description('Inspect a single session in full detail.')
  .action(async (sessionId: string) => {
    const { showSession } = await import('./commands/session.js');
    await showSession(sessionId);
  });

// ── approve ───────────────────────────────────────────────────────────────────
program
  .command('approve <sessionId>')
  .description('Approve a pending plan (Gate 1) from a separate terminal or CI pipeline.')
  .action(async (sessionId: string) => {
    const { approvePlan } = await import('./commands/approve.js');
    await approvePlan(sessionId);
  });

// ── learn ─────────────────────────────────────────────────────────────────────
program
  .command('learn')
  .description('Run a one-off research job to grow the knowledge base.')
  .requiredOption('-t, --topic <topic>', 'Topic to research (e.g. "idempotency payment")')
  .option('-d, --domain <domain>', 'Domain context. Default: payments')
  .option('-r, --repo <owner/repo>', 'Scope learned knowledge to this repo instead of global')
  .action(async (opts) => {
    const { runLearnJob } = await import('../learner/index.js');
    await runLearnJob(opts as { topic: string; domain?: string; repo?: string });
  });

// ── serve ─────────────────────────────────────────────────────────────────────
program
  .command('serve')
  .description('Start the MCP server for Cursor / Claude Code integration.')
  .option('-p, --port <port>', 'Port to listen on. Default: 3741')
  .option('-H, --host <host>', 'Host to bind to. Default: 127.0.0.1')
  .action(async (opts) => {
    const { startMcpServer } = await import('../mcp/server.js');
    await startMcpServer(opts as { port?: string; host?: string });
  });

// ── config ────────────────────────────────────────────────────────────────────
const configCmd = program
  .command('config')
  .description('Manage vigilant configuration.');

configCmd
  .command('show')
  .description('Show current configuration with sensitive values masked.')
  .action(async () => {
    const { showConfig } = await import('./commands/config.js');
    await showConfig();
  });

configCmd
  .command('set <keyValue>')
  .description('Update a config value. Example: vigilant config set watchIntervalSeconds=120')
  .action(async (keyValue: string) => {
    const { setConfig } = await import('./commands/config.js');
    await setConfig(keyValue);
  });
