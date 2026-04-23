# Phase 1 — Config System

**Files:** `src/config/index.ts`, `src/config/init.ts`, `src/config/types.ts`

## Objective

Design and implement the complete configuration system: loading from disk, validation, the first-run setup wizard, and config mutation commands. The config file is the only place secrets are stored, so security at this layer is critical.

---

## Config File Location

The config file lives at `~/.vigilant/config.json`. The `~/.vigilant/` directory is created if it does not exist. The file is always written with `chmod 0o600` — readable only by the owner process.

```typescript
// src/lib/constants.ts
import { homedir } from 'os';
import { join } from 'path';

export const VIGILANT_DIR        = join(homedir(), '.vigilant');
export const CONFIG_PATH         = join(VIGILANT_DIR, 'config.json');
export const STATE_DB_PATH       = join(VIGILANT_DIR, 'state.db');
export const KNOWLEDGE_DB_PATH   = join(VIGILANT_DIR, 'knowledge.db');
export const MAX_ITERATIONS      = 20;
export const DEFAULT_INTERVAL    = 60;
export const MIN_INTERVAL        = 30;
export const STALL_THRESHOLD     = 3;    // iterations without goalProgress change → blocked
export const CI_POLL_INTERVAL_MS = 60_000;
export const CI_TIMEOUT_MINUTES  = 30;
export const GOAL_PROGRESS_THRESHOLD = 0.9;
```

---

## Config Loading (`src/config/index.ts`)

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { VIGILANT_DIR, CONFIG_PATH, MAX_ITERATIONS, DEFAULT_INTERVAL } from '@/lib/constants';
import type { VigilantConfig, RawConfig, ConfigValidationResult } from './types';
import { ConfigError } from '@/lib/errors';

/** Load and validate config. Throws ConfigError if invalid. */
export function loadConfig(): VigilantConfig {
  if (!existsSync(CONFIG_PATH)) {
    throw new ConfigError(
      'No config found. Run `vigilant init` to set up.',
      'CONFIG_PATH'
    );
  }

  let raw: RawConfig;
  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    throw new ConfigError('config.json is not valid JSON. Run `vigilant init` to reset.', 'CONFIG_PATH');
  }

  const result = validateConfig(raw);
  if (!result.valid) throw new ConfigError(result.error);
  return result.config;
}

/** Validate a raw config object. Returns typed result. */
export function validateConfig(raw: RawConfig): ConfigValidationResult {
  if (!raw.githubToken) {
    return { valid: false, error: 'githubToken is required. Run `vigilant init`.' };
  }
  if (!raw.geminiApiKey && !raw.groqApiKey && !raw.openaiApiKey && !raw.ollamaBaseUrl) {
    return { valid: false, error: 'At least one AI provider key is required.' };
  }
  if (raw.domains && raw.domains.length === 0) {
    return { valid: false, error: 'At least one domain pack must be enabled.' };
  }

  const config: VigilantConfig = {
    githubToken: raw.githubToken,
    geminiApiKey: raw.geminiApiKey,
    groqApiKey: raw.groqApiKey,
    openaiApiKey: raw.openaiApiKey,
    ollamaBaseUrl: raw.ollamaBaseUrl,
    defaultRepos: raw.defaultRepos ?? [],
    watchIntervalSeconds: Math.max(raw.watchIntervalSeconds ?? DEFAULT_INTERVAL, 30),
    domains: raw.domains ?? ['payments'],
    maxIterations: raw.maxIterations ?? MAX_ITERATIONS,
    autoMerge: raw.autoMerge ?? false,
  };

  return { valid: true, config };
}

/** Save config to disk with 0o600 permissions. */
export function saveConfig(config: VigilantConfig): void {
  if (!existsSync(VIGILANT_DIR)) {
    mkdirSync(VIGILANT_DIR, { recursive: true, mode: 0o700 });
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { encoding: 'utf-8' });
  chmodSync(CONFIG_PATH, 0o600);
}

/** Update a single config key. Loads, mutates, saves. */
export function setConfigValue(key: string, value: string): void {
  const config = loadConfig();
  const mutable = config as Record<string, unknown>;

  // Parse booleans and numbers
  if (value === 'true') mutable[key] = true;
  else if (value === 'false') mutable[key] = false;
  else if (!isNaN(Number(value))) mutable[key] = Number(value);
  else mutable[key] = value;

  saveConfig(config);
}

/** Mask a secret value for display: show first 4 chars, rest as * */
export function maskSecret(value: string | undefined): string {
  if (!value) return '(not set)';
  return value.substring(0, 4) + '*'.repeat(Math.max(0, value.length - 4));
}
```

---

## Init Wizard (`src/config/init.ts`)

The wizard runs when `vigilant init` is called. It guides the user through the full setup interactively.

```typescript
import inquirer from 'inquirer';
import chalk from 'chalk';
import { saveConfig } from './index';
import { getStateDb, getKnowledgeDb } from '@/db/index';
import type { VigilantConfig } from './types';

export async function runInitWizard(): Promise<void> {
  console.log(chalk.bold.cyan('\n  vigilant — setup wizard\n'));
  console.log('  This will create ~/.vigilant/config.json\n');

  const answers = await inquirer.prompt([
    {
      type: 'password',
      name: 'githubToken',
      message: 'GitHub Personal Access Token (needs repo + workflow scopes):',
      validate: (v: string) => {
        if (!v) return 'Token is required';
        if (!v.startsWith('ghp_') && !v.startsWith('github_pat_')) {
          return 'Token should start with ghp_ or github_pat_';
        }
        return true;
      },
      mask: '*',
    },
    {
      type: 'list',
      name: 'primaryProvider',
      message: 'Primary AI provider:',
      choices: [
        { name: 'Google Gemini (recommended — generous free tier)', value: 'gemini' },
        { name: 'Groq (fast, free tier)', value: 'groq' },
        { name: 'OpenAI (GPT-4)', value: 'openai' },
        { name: 'Ollama (fully local, no API key)', value: 'ollama' },
      ],
    },
    {
      type: 'password',
      name: 'primaryApiKey',
      message: 'API key for chosen provider:',
      when: (a) => a.primaryProvider !== 'ollama',
      validate: (v: string) => v ? true : 'API key is required',
      mask: '*',
    },
    {
      type: 'input',
      name: 'ollamaBaseUrl',
      message: 'Ollama base URL:',
      default: 'http://localhost:11434',
      when: (a) => a.primaryProvider === 'ollama',
    },
    {
      type: 'checkbox',
      name: 'domains',
      message: 'Which domain packs to enable?',
      choices: [
        { name: 'payments  — idempotency, webhooks, payment error handling', value: 'payments', checked: true },
        { name: 'security  — secrets in code, SQL injection, auth checks', value: 'security' },
        { name: 'reliability — timeouts, circuit breakers, retry logic', value: 'reliability' },
      ],
      validate: (v: string[]) => v.length > 0 ? true : 'Select at least one domain',
    },
    {
      type: 'input',
      name: 'defaultRepos',
      message: 'Default repos to watch (optional, comma-separated owner/repo):',
      default: '',
    },
    {
      type: 'confirm',
      name: 'autoMerge',
      message: 'Auto-merge PRs when CI passes? (Gate 2 will be skipped)',
      default: false,
    },
  ]);

  // Build config from answers
  const config: VigilantConfig = {
    githubToken: answers.githubToken,
    domains: answers.domains,
    defaultRepos: answers.defaultRepos
      ? answers.defaultRepos.split(',').map((r: string) => r.trim()).filter(Boolean)
      : [],
    watchIntervalSeconds: 60,
    maxIterations: 20,
    autoMerge: answers.autoMerge,
  };

  if (answers.primaryProvider === 'gemini') config.geminiApiKey = answers.primaryApiKey;
  if (answers.primaryProvider === 'groq') config.groqApiKey = answers.primaryApiKey;
  if (answers.primaryProvider === 'openai') config.openaiApiKey = answers.primaryApiKey;
  if (answers.primaryProvider === 'ollama') config.ollamaBaseUrl = answers.ollamaBaseUrl;

  // Save config
  saveConfig(config);

  // Initialise databases
  getStateDb();
  getKnowledgeDb();

  // Print summary
  console.log(chalk.green('\n  ✅ Config saved to ~/.vigilant/config.json (permissions: 0600)'));
  console.log(chalk.green('  ✅ Databases initialised at ~/.vigilant/state.db + knowledge.db'));
  console.log(chalk.cyan('\n  Next step: vigilant start --repo owner/repo\n'));
}
```
