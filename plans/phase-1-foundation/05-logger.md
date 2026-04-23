# Phase 1 — Logger

**File:** `src/lib/logger.ts`

## Objective

A structured logger that every module uses. No `console.log` anywhere in the codebase except this file. Every log line includes a timestamp, level, and context (session ID or component name). Secrets are stripped before any line is written.

---

## Implementation

```typescript
import chalk from 'chalk';
import type { LogLevel, LogEntry } from './types';

// Patterns that indicate a secret — stripped before logging
const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9_]{36,}/g,
  /github_pat_[A-Za-z0-9_]{59,}/g,
  /AIza[0-9A-Za-z\-_]{35}/g,   // Gemini API key
  /gsk_[A-Za-z0-9]{52}/g,       // Groq API key
  /sk-[A-Za-z0-9]{48}/g,        // OpenAI key
];

const LEVEL_COLOURS: Record<LogLevel, (s: string) => string> = {
  DEBUG: chalk.grey,
  INFO:  chalk.white,
  WARN:  chalk.yellow,
  ERROR: chalk.red.bold,
};

/**
 * The main log function. Use this everywhere.
 * @param level   Log level
 * @param message Human-readable message (will be secret-stripped)
 * @param context Session ID, or component name like 'daemon', 'watcher', 'learner'
 * @param data    Optional structured data (will be secret-stripped)
 */
export function log(
  level: LogLevel,
  message: string,
  context: string = 'daemon',
  data?: Record<string, unknown>
): void {
  const timestamp = new Date().toISOString();
  const safeMessage = stripSecrets(message);
  const safeData = data ? stripSecretsFromObject(data) : undefined;

  const entry: LogEntry = { timestamp, level, context, message: safeMessage, data: safeData };

  const formatted = formatEntry(entry);
  process.stdout.write(formatted + '\n');
}

// Convenience wrappers
export const debug = (msg: string, ctx?: string, data?: Record<string, unknown>) =>
  log('DEBUG', msg, ctx, data);
export const info  = (msg: string, ctx?: string, data?: Record<string, unknown>) =>
  log('INFO',  msg, ctx, data);
export const warn  = (msg: string, ctx?: string, data?: Record<string, unknown>) =>
  log('WARN',  msg, ctx, data);
export const error = (msg: string, ctx?: string, data?: Record<string, unknown>) =>
  log('ERROR', msg, ctx, data);

function formatEntry(entry: LogEntry): string {
  const ts   = chalk.grey(entry.timestamp);
  const lvl  = LEVEL_COLOURS[entry.level](`[${entry.level.padEnd(5)}]`);
  const ctx  = chalk.cyan(`[${entry.context}]`);
  const msg  = LEVEL_COLOURS[entry.level](entry.message);
  const data = entry.data ? ' ' + JSON.stringify(entry.data) : '';
  return `${ts} ${lvl} ${ctx} ${msg}${data}`;
}

function stripSecrets(str: string): string {
  let result = str;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

function stripSecretsFromObject(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k,
      typeof v === 'string' ? stripSecrets(v) : v,
    ])
  );
}
```

---

## Usage Examples

```typescript
// In watcher tick:
info('Tick complete. Found 2 issues, 1 new session started', 'watcher');

// In agent loop:
info('Starting investigation', sessionId, { issueType: 'MISSING_IDEMPOTENCY' });
info('Step 0: getCurrentTime', sessionId, { iterationCount: 0 });
info('goalProgress advanced', sessionId, { from: 0.3, to: 0.6 });

// On error:
error('GitHub rate limited', 'watcher', { retryAfterSeconds: 60, endpoint: '/repos/pulls' });

// In executor:
info('Branch created', sessionId, { branchName: 'vigilant/fix/idempotency-pr47' });
info('File written', sessionId, { path: 'checkout/payment.ts', lines: 203 });
```

---

## Log Context Naming Convention

| Context value | When used |
|---|---|
| `daemon` | Daemon lifecycle: startup, shutdown, uncaught errors |
| `watcher` | Watcher tick, scanner results, dedup |
| `SESS_vigilant_...` | Any agent loop operation — always use the full session ID |
| `executor` | Branch/file/PR/CI operations (also include session ID in data) |
| `learner` | Idle research jobs |
| `mcp` | MCP server requests and responses |
| `init` | Init wizard steps |
