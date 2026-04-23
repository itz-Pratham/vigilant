// src/cli/commands/config.ts

import chalk from 'chalk';
import { loadConfig, setConfigValue, maskSecret } from '../../config/index.js';
import { ConfigError } from '../../lib/errors.js';

export async function showConfig(): Promise<void> {
  try {
    const config = loadConfig();
    console.log(chalk.bold.cyan('\n  vigilant config\n'));

    const rows: [string, string][] = [
      ['githubToken',          maskSecret(config.githubToken)],
      ['geminiApiKey',         maskSecret(config.geminiApiKey)],
      ['groqApiKey',           maskSecret(config.groqApiKey)],
      ['openaiApiKey',         maskSecret(config.openaiApiKey)],
      ['ollamaBaseUrl',        config.ollamaBaseUrl  ?? '(not set)'],
      ['domains',              config.domains.join(', ')],
      ['defaultRepos',         config.defaultRepos.join(', ') || '(none)'],
      ['watchIntervalSeconds', String(config.watchIntervalSeconds)],
      ['maxIterations',        String(config.maxIterations)],
      ['autoMerge',            String(config.autoMerge)],
    ];

    const keyWidth = Math.max(...rows.map(([k]) => k.length)) + 2;
    for (const [key, val] of rows) {
      console.log(`  ${chalk.grey(key.padEnd(keyWidth))}${val}`);
    }
    console.log();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(chalk.red(`\n  ${err.message}\n`));
      process.exit(1);
    }
    throw err;
  }
}

export async function setConfig(keyValue: string): Promise<void> {
  const eqIdx = keyValue.indexOf('=');
  if (eqIdx === -1) {
    console.error(chalk.red('\n  Usage: vigilant config set key=value\n'));
    process.exit(1);
  }

  const key   = keyValue.substring(0, eqIdx).trim();
  const value = keyValue.substring(eqIdx + 1).trim();

  try {
    setConfigValue(key, value);
    console.log(chalk.green(`\n  ✅ ${key} updated\n`));
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(chalk.red(`\n  ${err.message}\n`));
      process.exit(1);
    }
    throw err;
  }
}
