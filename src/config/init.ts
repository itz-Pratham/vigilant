// src/config/init.ts

import inquirer from 'inquirer';
import chalk from 'chalk';
import { saveConfig } from './index.js';
import { getStateDb, getKnowledgeDb } from '../db/index.js';
import type { VigilantConfig } from './types.js';

export async function runInitWizard(): Promise<void> {
  console.log(chalk.bold.cyan('\n  vigilant — setup wizard\n'));
  console.log('  Creates ~/.vigilant/config.json (permissions: 0600)\n');
  console.log(chalk.grey('  Tip: you can also set VIGILANT_GITHUB_TOKEN and VIGILANT_GEMINI_KEY (etc.)\n  in a .env file to override these values at runtime.\n'));

  type Answers = {
    githubToken:     string;
    primaryProvider: string;
    primaryApiKey?:  string;
    ollamaBaseUrl?:  string;
    domains:         string[];
    defaultRepos:    string;
    autoMerge:       boolean;
  };

  const answers = await inquirer.prompt<Answers>([
    {
      type:     'password',
      name:     'githubToken',
      message:  'GitHub Personal Access Token (needs Contents, Pull Requests, Issues, Workflows R/W):',
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
      type:    'list',
      name:    'primaryProvider',
      message: 'Primary AI provider:',
      choices: [
        { name: 'Google Gemini  (recommended — generous free tier)', value: 'gemini' },
        { name: 'Groq           (fast, free tier)',                   value: 'groq'   },
        { name: 'OpenAI         (GPT-4, paid)',                       value: 'openai' },
        { name: 'Ollama         (fully local, no API key)',           value: 'ollama' },
      ],
    },
    {
      type:     'password',
      name:     'primaryApiKey',
      message:  'API key for chosen provider:',
      when:     (a: Answers) => a.primaryProvider !== 'ollama',
      validate: (v: string) => v ? true : 'API key is required',
      mask:     '*',
    },
    {
      type:    'input',
      name:    'ollamaBaseUrl',
      message: 'Ollama base URL:',
      default: 'http://localhost:11434',
      when:    (a: Answers) => a.primaryProvider === 'ollama',
    },
    {
      type:     'checkbox',
      name:     'domains',
      message:  'Which domain packs to enable?',
      choices: [
        { name: 'payments    — idempotency, webhooks, payment error handling', value: 'payments',    checked: true  },
        { name: 'security    — secrets in code, SQL injection, auth checks',   value: 'security',    checked: false },
        { name: 'reliability — timeouts, circuit breakers, retry logic',       value: 'reliability', checked: false },
        { name: 'compliance  — PII in logs, GDPR, audit trails',               value: 'compliance',  checked: false },
      ],
      validate: (v: string[]) => v.length > 0 ? true : 'Select at least one domain',
    },
    {
      type:    'input',
      name:    'defaultRepos',
      message: 'Default repos to watch (optional, comma-separated owner/repo):',
      default: '',
    },
    {
      type:    'confirm',
      name:    'autoMerge',
      message: 'Auto-merge PRs when CI passes? (skips Gate 2 prompt)',
      default: false,
    },
  ]);

  const config: VigilantConfig = {
    githubToken:          answers.githubToken,
    domains:              answers.domains,
    defaultRepos:         answers.defaultRepos
      ? answers.defaultRepos.split(',').map((r: string) => r.trim()).filter(Boolean)
      : [],
    watchIntervalSeconds: 60,
    maxIterations:        20,
    autoMerge:            answers.autoMerge,
  };

  const provider = answers.primaryProvider;
  if (provider === 'gemini') config.geminiApiKey  = answers.primaryApiKey;
  if (provider === 'groq')   config.groqApiKey    = answers.primaryApiKey;
  if (provider === 'openai') config.openaiApiKey  = answers.primaryApiKey;
  if (provider === 'ollama') config.ollamaBaseUrl = answers.ollamaBaseUrl;

  saveConfig(config);

  // Initialise both databases (creates tables if they don't exist)
  getStateDb();
  getKnowledgeDb();

  console.log(chalk.green('\n  ✅ Config saved to ~/.vigilant/config.json (permissions: 0600)'));
  console.log(chalk.green('  ✅ Databases initialised at ~/.vigilant/state.db + knowledge.db'));
  console.log(chalk.cyan('\n  Next step: vigilant start --repo owner/repo\n'));
}
