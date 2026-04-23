# Phase 1 — CLI Entry Point

**File:** `src/cli/index.ts`

## Objective

Define all CLI commands using Commander.js. Every command is registered here with its exact flags, descriptions, and argument types. Command implementations are delegated to their respective phase modules — the CLI file itself stays thin.

---

## Full CLI Definition

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { join } from 'path';

const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));
const program = new Command();

program
  .name('vigilant')
  .description('Autonomous code intelligence daemon — watches your repo, finds issues, fixes them.')
  .version(pkg.version);

// ── init ──────────────────────────────────────────────────────────────
program
  .command('init')
  .description('First-time setup wizard. Creates ~/.vigilant/config.json and initialises databases.')
  .action(async () => {
    const { runInitWizard } = await import('@/config/init');
    await runInitWizard();
  });

// ── start ─────────────────────────────────────────────────────────────
program
  .command('start')
  .description('Start the vigilant daemon for a repository.')
  .requiredOption('-r, --repo <owner/repo>', 'GitHub repository to watch (e.g. myorg/myrepo)')
  .option('-d, --domain <domain>', 'Domain pack to use. Overrides config. (payments|security|reliability)')
  .option('-i, --interval <seconds>', 'Watcher tick interval in seconds. Min 30. Default: 60')
  .action(async (opts) => {
    const { startDaemon } = await import('@/watcher/index');
    await startDaemon(opts);
  });

// ── status ────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show all active vigilant sessions and their current stage.')
  .option('-r, --repo <owner/repo>', 'Filter by repository')
  .option('--all', 'Include completed sessions (merged, skipped, closed)')
  .action(async (opts) => {
    const { showStatus } = await import('@/cli/commands/status');
    await showStatus(opts);
  });

// ── session ───────────────────────────────────────────────────────────
program
  .command('session <sessionId>')
  .description('Inspect a single session in full detail.')
  .action(async (sessionId: string) => {
    const { showSession } = await import('@/cli/commands/session');
    await showSession(sessionId);
  });

// ── approve ───────────────────────────────────────────────────────────
program
  .command('approve <sessionId>')
  .description('Approve a pending plan (Gate 1) from a separate terminal or CI pipeline.')
  .action(async (sessionId: string) => {
    const { approvePlan } = await import('@/cli/commands/approve');
    await approvePlan(sessionId);
  });

// ── learn ─────────────────────────────────────────────────────────────
program
  .command('learn')
  .description('Run a one-off research job to grow the knowledge base.')
  .requiredOption('-t, --topic <topic>', 'Topic to research (e.g. "idempotency payment")')
  .option('-d, --domain <domain>', 'Domain context for the research. Default: payments')
  .option('-r, --repo <owner/repo>', 'Scope learned knowledge to this repo instead of global')
  .action(async (opts) => {
    const { runLearnJob } = await import('@/learner/index');
    await runLearnJob(opts);
  });

// ── serve ─────────────────────────────────────────────────────────────
program
  .command('serve')
  .description('Start the MCP server for Cursor/Claude Code integration.')
  .option('-p, --port <port>', 'Port to listen on. Default: 3001')
  .option('-H, --host <host>', 'Host to bind to. Default: 127.0.0.1 (localhost only)')
  .action(async (opts) => {
    const { startMcpServer } = await import('@/mcp/server');
    await startMcpServer(opts);
  });

// ── config ────────────────────────────────────────────────────────────
const configCmd = program.command('config').description('Manage vigilant configuration.');

configCmd
  .command('show')
  .description('Show current configuration with sensitive values masked.')
  .action(async () => {
    const { showConfig } = await import('@/cli/commands/config');
    await showConfig();
  });

configCmd
  .command('set <key=value>')
  .description('Update a configuration value. Example: vigilant config set watchIntervalSeconds=120')
  .action(async (keyValue: string) => {
    const { setConfig } = await import('@/cli/commands/config');
    await setConfig(keyValue);
  });

program.parseAsync(process.argv);
```

---

## `config show` Command Output

```
  vigilant config

  githubToken           ghp_****************************XXXX
  geminiApiKey          AIza****************************XXXX
  groqApiKey            (not set)
  domains               payments, security
  defaultRepos          myorg/backend, myorg/checkout
  watchIntervalSeconds  60
  maxIterations         20
  autoMerge             false
```

---

## `config set` Parsing Rules

The `key=value` argument is split on the first `=`. Values are parsed as follows:
- `"true"` → `true` (boolean)
- `"false"` → `false` (boolean)
- Numeric string → `number`
- Everything else → `string`
- Comma-separated values for array fields (e.g. `domains=payments,security`) → `string[]`

Known array fields: `defaultRepos`, `domains`. When these are set, split by `,` and trim.
