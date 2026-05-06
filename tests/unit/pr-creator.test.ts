// tests/unit/pr-creator.test.ts
// Unit tests for src/executor/pr-creator.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { createPR }           from '../../src/executor/pr-creator.js';
import { ExecutorError }      from '../../src/lib/errors.js';
import type { IssueSession }  from '../../src/agent/types.js';
import type { ExecutorContext } from '../../src/executor/types.js';

const CTX: ExecutorContext = {
  owner:         'acme',
  repo:          'api',
  branchName:    'vigilant/fix-missing-idempotency-key-abc1234',
  baseSha:       'abc1234',
  defaultBranch: 'main',
};

const SESSION: IssueSession = {
  sessionId:       'SESS_test',
  repoOwner:       'acme',
  repoName:        'api',
  domain:          'payments',
  issueType:       'MISSING_IDEMPOTENCY_KEY',
  stage:           'executing',
  severity:        'HIGH',
  confidence:      0.8,
  sourceRef:       'pr/42',
  evidence:        [],
  iterationCount:  1,
  goalProgress:    0.8,
  keyFindings:     ['found issue'],
  dataCollected:   {},
  plan: {
    summary:                'Add idempotency key',
    rootCause:              'Missing key',
    changes:                [{ path: 'src/payment.ts', description: 'Add key', before: 'old', after: 'new' }],
    testSuggestions:        ['test that retry is safe'],
    riskLevel:              'LOW',
    estimatedReviewMinutes: 5,
    branchName:             'vigilant/fix-missing-idempotency-key-abc1234',
  },
  branchName:      'vigilant/fix-missing-idempotency-key-abc1234',
  prNumber:        null,
  prUrl:           null,
  prHeadSha:       null,
  ciStatus:        null,
  executorStep:    null,
  selfReviewCount: 0,
  blockerReason:   null,
  stallCount:      0,
  runNumber:       1,
  createdAt:       '2024-01-01T00:00:00.000Z',
  updatedAt:       '2024-01-01T00:00:00.000Z',
};

beforeEach(() => vi.clearAllMocks());

describe('createPR', () => {
  it('creates a new PR and returns its number, url, and head sha', async () => {
    // First call: list existing PRs (none found)
    mockGithubRequest.mockResolvedValueOnce([]);
    // Second call: create PR
    mockGithubRequest.mockResolvedValueOnce({
      number:   99,
      html_url: 'https://github.com/acme/api/pull/99',
      head:     { sha: 'deadbeef' },
    });

    const result = await createPR(SESSION, CTX);
    expect(result.prNumber).toBe(99);
    expect(result.prUrl).toBe('https://github.com/acme/api/pull/99');
    expect(result.prHeadSha).toBe('deadbeef');
  });

  it('reuses an existing PR for the same branch (crash recovery)', async () => {
    // list returns an existing open PR
    mockGithubRequest.mockResolvedValueOnce([
      { number: 77, html_url: 'https://github.com/acme/api/pull/77', head: { sha: 'aabbcc' } },
    ]);

    const result = await createPR(SESSION, CTX);
    expect(result.prNumber).toBe(77);
    expect(result.prHeadSha).toBe('aabbcc');
    // Should NOT have called pulls.create
    expect(mockGithubRequest).toHaveBeenCalledTimes(1);
  });

  it('throws ExecutorError when PR creation fails', async () => {
    mockGithubRequest.mockResolvedValueOnce([]);  // no existing PR
    const err = Object.assign(new Error('Forbidden'), { status: 403 });
    mockGithubRequest.mockRejectedValueOnce(err);

    await expect(createPR(SESSION, CTX)).rejects.toBeInstanceOf(ExecutorError);
  });

  it('ExecutorError has step=pr on failure', async () => {
    mockGithubRequest.mockResolvedValueOnce([]);
    const err = Object.assign(new Error('Forbidden'), { status: 403 });
    mockGithubRequest.mockRejectedValueOnce(err);

    try {
      await createPR(SESSION, CTX);
    } catch (e) {
      expect((e as ExecutorError).step).toBe('pr');
    }
  });

  it('proceeds even if existing-PR check throws', async () => {
    // First call: list PRs throws (no access) — should fall through to create
    mockGithubRequest.mockRejectedValueOnce(new Error('Network error'));
    // Second call: create PR succeeds
    mockGithubRequest.mockResolvedValueOnce({
      number:   55,
      html_url: 'https://github.com/acme/api/pull/55',
      head:     { sha: 'ff00ff' },
    });

    const result = await createPR(SESSION, CTX);
    expect(result.prNumber).toBe(55);
  });

  it('throws ExecutorError if session has no plan', async () => {
    const sessionNoPlan = { ...SESSION, plan: null };
    await expect(createPR(sessionNoPlan, CTX)).rejects.toBeInstanceOf(ExecutorError);
  });
});
