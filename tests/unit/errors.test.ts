// tests/unit/errors.test.ts
// Unit tests for src/lib/errors.ts — every error class, every custom property.

import { describe, it, expect } from 'vitest';
import {
  VigilantError,
  ConfigError,
  GitHubAPIError,
  GitHubRateLimitError,
  AIProviderError,
  DatabaseError,
  AgentLoopError,
  ToolExecutionError,
  ExecutorError,
} from '../../src/lib/errors.js';

describe('VigilantError', () => {
  it('sets message and name', () => {
    const e = new VigilantError('base');
    expect(e.message).toBe('base');
    expect(e.name).toBe('VigilantError');
    expect(e).toBeInstanceOf(Error);
  });
});

describe('ConfigError', () => {
  it('sets name and is VigilantError', () => {
    const e = new ConfigError('bad config');
    expect(e.name).toBe('ConfigError');
    expect(e).toBeInstanceOf(VigilantError);
  });
});

describe('GitHubAPIError', () => {
  it('stores statusCode and endpoint', () => {
    const e = new GitHubAPIError('not found', 404, '/repos/foo/bar');
    expect(e.statusCode).toBe(404);
    expect(e.endpoint).toBe('/repos/foo/bar');
    expect(e.name).toBe('GitHubAPIError');
  });
});

describe('GitHubRateLimitError', () => {
  it('constructs with retry delay and derives message', () => {
    const e = new GitHubRateLimitError(30, '/repos/foo/bar');
    expect(e.retryAfterSeconds).toBe(30);
    expect(e.statusCode).toBe(429);
    expect(e.message).toContain('30');
    expect(e.name).toBe('GitHubRateLimitError');
    expect(e).toBeInstanceOf(GitHubAPIError);
  });
});

describe('AIProviderError', () => {
  it('stores optional statusCode and provider', () => {
    const e = new AIProviderError('quota exceeded', 429, 'gemini');
    expect(e.statusCode).toBe(429);
    expect(e.provider).toBe('gemini');
    expect(e.name).toBe('AIProviderError');
  });

  it('works without optional args', () => {
    const e = new AIProviderError('unknown AI error');
    expect(e.statusCode).toBeUndefined();
    expect(e.provider).toBeUndefined();
  });
});

describe('DatabaseError', () => {
  it('stores operation', () => {
    const e = new DatabaseError('insert failed', 'createSession');
    expect(e.operation).toBe('createSession');
    expect(e.name).toBe('DatabaseError');
  });
});

describe('AgentLoopError', () => {
  it('stores sessionId', () => {
    const e = new AgentLoopError('stalled', 'SESS_abc');
    expect(e.sessionId).toBe('SESS_abc');
    expect(e.name).toBe('AgentLoopError');
    expect(e).toBeInstanceOf(VigilantError);
  });
});

describe('ToolExecutionError', () => {
  it('stores toolName', () => {
    const e = new ToolExecutionError('readFile failed', 'readFile');
    expect(e.toolName).toBe('readFile');
    expect(e.name).toBe('ToolExecutionError');
  });
});

describe('ExecutorError', () => {
  it('stores step and sessionId', () => {
    const e = new ExecutorError('branch failed', 'branch', 'SESS_x');
    expect(e.step).toBe('branch');
    expect(e.sessionId).toBe('SESS_x');
    expect(e.name).toBe('ExecutorError');
    expect(e).toBeInstanceOf(VigilantError);
  });
});
