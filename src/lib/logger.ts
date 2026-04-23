// src/lib/logger.ts

import chalk from 'chalk';
import type { LogLevel, LogEntry } from './types.js';

// Regex patterns that match common secret formats — redacted before any output
const SECRET_PATTERNS: RegExp[] = [
  /ghp_[A-Za-z0-9_]{36,}/g,
  /github_pat_[A-Za-z0-9_]{59,}/g,
  /AIza[0-9A-Za-z\-_]{35}/g,
  /gsk_[A-Za-z0-9]{52}/g,
  /sk-[A-Za-z0-9]{48}/g,
];

const LEVEL_COLOURS: Record<LogLevel, (s: string) => string> = {
  DEBUG: chalk.grey,
  INFO:  chalk.white,
  WARN:  chalk.yellow,
  ERROR: chalk.red.bold,
};

export function log(
  level: LogLevel,
  message: string,
  context: string = 'daemon',
  data?: Record<string, unknown>,
): void {
  const timestamp    = new Date().toISOString();
  const safeMessage  = stripSecrets(message);
  const safeData     = data ? stripSecretsFromObject(data) : undefined;
  const entry: LogEntry = { timestamp, level, context, message: safeMessage, data: safeData };
  process.stdout.write(formatEntry(entry) + '\n');
}

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
    ]),
  );
}
