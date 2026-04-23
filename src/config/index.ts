// src/config/index.ts

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { VIGILANT_DIR, CONFIG_PATH, DEFAULT_WATCH_INTERVAL_SECONDS, DEFAULT_MAX_ITERATIONS, MIN_WATCH_INTERVAL_SECONDS } from '../lib/constants.js';
import type { VigilantConfig, RawConfig, ConfigValidationResult } from './types.js';
import { ConfigError } from '../lib/errors.js';

/**
 * Load config from disk, then overlay any env vars on top.
 * Priority: VIGILANT_* env vars > ~/.vigilant/config.json
 * Throws ConfigError if no valid config can be assembled.
 */
export function loadConfig(): VigilantConfig {
  let base: RawConfig = {};

  if (existsSync(CONFIG_PATH)) {
    try {
      base = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as RawConfig;
    } catch {
      throw new ConfigError('config.json is not valid JSON. Run `vigilant init` to reset.');
    }
  }

  // Env vars override file values
  const merged: RawConfig = {
    ...base,
    githubToken:  process.env['VIGILANT_GITHUB_TOKEN'] || base.githubToken,
    geminiApiKey: process.env['VIGILANT_GEMINI_KEY']   || base.geminiApiKey,
    groqApiKey:   process.env['VIGILANT_GROQ_KEY']     || base.groqApiKey,
    openaiApiKey: process.env['VIGILANT_OPENAI_KEY']   || base.openaiApiKey,
    ollamaBaseUrl:process.env['VIGILANT_OLLAMA_URL']   || base.ollamaBaseUrl,
  };

  const result = validateConfig(merged);
  if (!result.valid) {
    throw new ConfigError(result.error + '\n  Run `vigilant init` to set up, or set VIGILANT_* env vars.');
  }
  return result.config;
}

/** Validate a raw config object and return a typed result. */
export function validateConfig(raw: RawConfig): ConfigValidationResult {
  if (!raw.githubToken) {
    return { valid: false, error: 'githubToken is required (VIGILANT_GITHUB_TOKEN or `vigilant init`).' };
  }
  if (!raw.geminiApiKey && !raw.groqApiKey && !raw.openaiApiKey && !raw.ollamaBaseUrl) {
    return { valid: false, error: 'At least one AI provider key is required (VIGILANT_GEMINI_KEY, VIGILANT_GROQ_KEY, VIGILANT_OPENAI_KEY, or VIGILANT_OLLAMA_URL).' };
  }
  if (raw.domains && raw.domains.length === 0) {
    return { valid: false, error: 'At least one domain pack must be enabled.' };
  }

  const config: VigilantConfig = {
    githubToken:          raw.githubToken,
    geminiApiKey:         raw.geminiApiKey,
    groqApiKey:           raw.groqApiKey,
    openaiApiKey:         raw.openaiApiKey,
    ollamaBaseUrl:        raw.ollamaBaseUrl,
    defaultRepos:         raw.defaultRepos         ?? [],
    watchIntervalSeconds: Math.max(raw.watchIntervalSeconds ?? DEFAULT_WATCH_INTERVAL_SECONDS, MIN_WATCH_INTERVAL_SECONDS),
    domains:              raw.domains              ?? ['payments'],
    maxIterations:        raw.maxIterations        ?? DEFAULT_MAX_ITERATIONS,
    autoMerge:            raw.autoMerge            ?? false,
  };

  return { valid: true, config };
}

/** Write config to disk with owner-read-only permissions (0o600). */
export function saveConfig(config: VigilantConfig): void {
  if (!existsSync(VIGILANT_DIR)) {
    mkdirSync(VIGILANT_DIR, { recursive: true, mode: 0o700 });
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { encoding: 'utf-8' });
  chmodSync(CONFIG_PATH, 0o600);
}

/** Update a single config key in-place. Loads, patches, saves. */
export function setConfigValue(key: string, value: string): void {
  const config  = loadConfig();
  const mutable = config as Record<string, unknown>;

  const ARRAY_FIELDS = new Set(['defaultRepos', 'domains']);

  if (ARRAY_FIELDS.has(key)) {
    mutable[key] = value.split(',').map(v => v.trim()).filter(Boolean);
  } else if (value === 'true') {
    mutable[key] = true;
  } else if (value === 'false') {
    mutable[key] = false;
  } else if (!isNaN(Number(value)) && value.trim() !== '') {
    mutable[key] = Number(value);
  } else {
    mutable[key] = value;
  }

  saveConfig(config);
}

/** Mask a secret for display: first 4 chars visible, rest replaced with *. */
export function maskSecret(value: string | undefined): string {
  if (!value) return '(not set)';
  return value.substring(0, 4) + '*'.repeat(Math.max(0, value.length - 4));
}
