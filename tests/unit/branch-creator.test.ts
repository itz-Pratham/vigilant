// tests/unit/branch-creator.test.ts
// Unit tests for src/executor/branch-creator.ts
// githubRequest is mocked so no real API calls are made.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock githubRequest ────────────────────────────────────────────────────────

const mockGithubRequest = vi.fn();

vi.mock('../../src/lib/github.js', () => ({
  getGitHub:     vi.fn(),
  githubRequest: (...args: unknown[]) => mockGithubRequest(...args),
}));

vi.mock('../../src/lib/logger.js', () => ({
  info:  vi.fn(),
  warn:  vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

import { resolveBaseSha, createBranch } from '../../src/executor/branch-creator.js';
import { ExecutorError }                from '../../src/lib/errors.js';
import type { ExecutorContext }         from '../../src/executor/types.js';

const CTX: ExecutorContext = {
  owner:         'acme',
  repo:          'api',
  branchName:    'vigilant/fix-missing-idempotency-key-abc1234',
  baseSha:       'abc1234abc1234abc1234abc1234abc1234abc1234',
  defaultBranch: 'main',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveBaseSha', () => {
  it('returns defaultBranch and sha from GitHub', async () => {
    mockGithubRequest
      .mockResolvedValueOnce({ default_branch: 'main' })         // repos.get
      .mockResolvedValueOnce({ object: { sha: 'deadbeef' } });   // git.getRef

    const result = await resolveBaseSha('acme', 'api');
    expect(result.defaultBranch).toBe('main');
    expect(result.sha).toBe('deadbeef');
    expect(mockGithubRequest).toHaveBeenCalledTimes(2);
  });

  it('uses the repo default_branch (not hard-coded main)', async () => {
    mockGithubRequest
      .mockResolvedValueOnce({ default_branch: 'master' })
      .mockResolvedValueOnce({ object: { sha: 'cafebabe' } });

    const result = await resolveBaseSha('acme', 'api');
    expect(result.defaultBranch).toBe('master');
  });
});

describe('createBranch', () => {
  it('creates the branch successfully', async () => {
    mockGithubRequest.mockResolvedValueOnce({ ref: `refs/heads/${CTX.branchName}` });
    await expect(createBranch(CTX, 'SESS_test')).resolves.toBeUndefined();
    expect(mockGithubRequest).toHaveBeenCalledTimes(1);
  });

  it('treats 422 (branch already exists) as success — crash recovery', async () => {
    const err = Object.assign(new Error('Reference already exists'), { status: 422 });
    mockGithubRequest.mockRejectedValueOnce(err);
    await expect(createBranch(CTX, 'SESS_test')).resolves.toBeUndefined();
  });

  it('throws ExecutorError on 403 (no push access)', async () => {
    const err = Object.assign(new Error('Resource not accessible'), { status: 403 });
    mockGithubRequest.mockRejectedValueOnce(err);
    await expect(createBranch(CTX, 'SESS_test')).rejects.toBeInstanceOf(ExecutorError);
  });

  it('throws ExecutorError on 404 (repo not found)', async () => {
    const err = Object.assign(new Error('Not Found'), { status: 404 });
    mockGithubRequest.mockRejectedValueOnce(err);
    await expect(createBranch(CTX, 'SESS_test')).rejects.toBeInstanceOf(ExecutorError);
  });

  it('ExecutorError has step=branch', async () => {
    const err = Object.assign(new Error('Forbidden'), { status: 403 });
    mockGithubRequest.mockRejectedValueOnce(err);
    try {
      await createBranch(CTX, 'SESS_test');
    } catch (e) {
      expect(e).toBeInstanceOf(ExecutorError);
      expect((e as ExecutorError).step).toBe('branch');
      expect((e as ExecutorError).sessionId).toBe('SESS_test');
    }
  });
});
