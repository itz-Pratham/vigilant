// tests/unit/config-validation.test.ts
// Unit tests for src/config/index.ts — validateConfig

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateConfig } from '../../src/config/index.js';

describe('validateConfig', () => {
  it('returns valid config when githubToken + geminiApiKey present', () => {
    const result = validateConfig({ githubToken: 'gh_abc', geminiApiKey: 'gm_xyz' });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.config.githubToken).toBe('gh_abc');
      expect(result.config.geminiApiKey).toBe('gm_xyz');
    }
  });

  it('fails when githubToken missing', () => {
    const result = validateConfig({ geminiApiKey: 'gm_xyz' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('githubToken');
    }
  });

  it('fails when no AI provider key is provided', () => {
    const result = validateConfig({ githubToken: 'gh_abc' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/provider|key/i);
    }
  });

  it('accepts groqApiKey as valid AI provider', () => {
    const result = validateConfig({ githubToken: 'gh_abc', groqApiKey: 'gr_xyz' });
    expect(result.valid).toBe(true);
  });

  it('accepts openaiApiKey as valid AI provider', () => {
    const result = validateConfig({ githubToken: 'gh_abc', openaiApiKey: 'sk_xyz' });
    expect(result.valid).toBe(true);
  });

  it('accepts ollamaBaseUrl as valid AI provider', () => {
    const result = validateConfig({ githubToken: 'gh_abc', ollamaBaseUrl: 'http://localhost:11434' });
    expect(result.valid).toBe(true);
  });

  it('fails when domains is explicitly set to empty array', () => {
    const result = validateConfig({ githubToken: 'gh_abc', geminiApiKey: 'gm_xyz', domains: [] });
    expect(result.valid).toBe(false);
  });

  it('applies defaults for optional fields', () => {
    const result = validateConfig({ githubToken: 'gh_abc', geminiApiKey: 'gm_xyz' });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.config.domains).toEqual(['payments']);
      expect(result.config.autoMerge).toBe(false);
      expect(result.config.watchIntervalSeconds).toBeGreaterThan(0);
    }
  });

  it('enforces minimum watchIntervalSeconds', () => {
    const result = validateConfig({ githubToken: 'gh_abc', geminiApiKey: 'gm_xyz', watchIntervalSeconds: 1 });
    expect(result.valid).toBe(true);
    if (result.valid) {
      // Should be clamped to MIN_WATCH_INTERVAL_SECONDS (30)
      expect(result.config.watchIntervalSeconds).toBeGreaterThanOrEqual(30);
    }
  });
});
