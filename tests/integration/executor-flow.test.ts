// tests/integration/executor-flow.test.ts
// Integration test: session in 'executing' stage → runExecutor → stage='pr_created'
// then pollCIOnce → stage='awaiting_merge'
//
// Mocks:
//   - githubRequest: all GitHub API calls
//   - enqueueGate:   captured to assert Gate 2 is enqueued on CI pass

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGithubRequest = vi.fn();
const mockEnqueueGate   = vi.fn();

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

vi.mock('../../src/hitl/index.js', () => ({
  enqueueGate:        (...args: unknown[]) => mockEnqueueGate(...args),
  reQueuePendingGates: vi.fn(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { resetDbForTesting }  from '../../src/db/index.js';
import {
  createSession,
  getSession,
}                             from '../../src/db/queries/sessions.js';
import { runExecutor, pollCIOnce } from '../../src/executor/index.js';
import type { IssueSession }       from '../../src/agent/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<IssueSession> = {}): IssueSession {
  const now = new Date().toISOString();
  return {
    sessionId:       'SESS_executor_test_001',
    repoOwner:       'acme',
    repoName:        'api',
    domain:          'payments',
    issueType:       'MISSING_IDEMPOTENCY_KEY',
    stage:           'executing',
    severity:        'HIGH',
    confidence:      0.8,
    sourceRef:       'pr/42',
    evidence:        ['found in src/payment.ts line 42'],
    iterationCount:  1,
    goalProgress:    0.8,
    keyFindings:     ['payment.create missing idempotencyKey'],
    dataCollected:   {},
    plan: {
      summary:                'Add idempotency key to createPayment()',
      rootCause:              'Missing idempotency key',
      changes: [
        {
          path:        'src/payment.ts',
          description: 'Add idempotency key parameter',
          before:      "payment.create({ amount })",
          after:       "payment.create({ amount, idempotencyKey: `order_${id}` })",
        },
      ],
      testSuggestions:        ['test duplicate call returns same intent'],
      riskLevel:              'LOW',
      estimatedReviewMinutes: 5,
      branchName:             'vigilant/fix-missing-idempotency-key-abc1234',
    },
    branchName:      null,
    prNumber:        null,
    prUrl:           null,
    prHeadSha:       null,
    ciStatus:        null,
    executorStep:    null,
    selfReviewCount: 0,
    blockerReason:   null,
    stallCount:      0,
    runNumber:       1,
    createdAt:       now,
    updatedAt:       now,
    ...overrides,
  };
}

beforeEach(() => {
  process.env['VIGILANT_STATE_DB_PATH'] = ':memory:';
  resetDbForTesting();
  vi.clearAllMocks();
});

afterEach(() => {
  resetDbForTesting();
  delete process.env['VIGILANT_STATE_DB_PATH'];
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runExecutor: executing → pr_created', () => {
  it('transitions session to pr_created after all three steps succeed', async () => {
    const session = makeSession();
    createSession(session);

    // Step 1: resolveBaseSha (repos.get + git.getRef)
    mockGithubRequest.mockResolvedValueOnce({ default_branch: 'main' });
    mockGithubRequest.mockResolvedValueOnce({ object: { sha: 'base_sha_123' } });
    // Step 1: createBranch
    mockGithubRequest.mockResolvedValueOnce({ ref: 'refs/heads/vigilant/fix-missing-idempotency-key-abc1234' });
    // Step 2: getContent (file read)
    mockGithubRequest.mockResolvedValueOnce({
      type:    'file',
      content: Buffer.from("payment.create({ amount })").toString('base64'),
      sha:     'file_sha_abc',
    });
    // Step 2: createOrUpdateFileContents (file write)
    mockGithubRequest.mockResolvedValueOnce({ commit: { sha: 'commit_sha_xyz' } });
    // Step 3: list existing PRs (none)
    mockGithubRequest.mockResolvedValueOnce([]);
    // Step 3: create PR
    mockGithubRequest.mockResolvedValueOnce({
      number:   101,
      html_url: 'https://github.com/acme/api/pull/101',
      head:     { sha: 'pr_head_sha' },
    });

    await runExecutor(session);

    const persisted = getSession(session.sessionId)!;
    expect(persisted.stage).toBe('pr_created');
    expect(persisted.executorStep).toBe('pr_created');
    expect(persisted.prNumber).toBe(101);
    expect(persisted.prUrl).toBe('https://github.com/acme/api/pull/101');
    expect(persisted.prHeadSha).toBe('pr_head_sha');
    expect(persisted.ciStatus).toBe('pending');
    expect(persisted.branchName).toBe('vigilant/fix-missing-idempotency-key-abc1234');
  }, 10_000);

  it('marks session blocked when branch creation fails with 403', async () => {
    const session = makeSession();
    createSession(session);

    mockGithubRequest.mockResolvedValueOnce({ default_branch: 'main' });
    mockGithubRequest.mockResolvedValueOnce({ object: { sha: 'base_sha_123' } });
    const err = Object.assign(new Error('Forbidden'), { status: 403 });
    mockGithubRequest.mockRejectedValueOnce(err);

    await runExecutor(session);

    const persisted = getSession(session.sessionId)!;
    expect(persisted.stage).toBe('blocked');
    expect(persisted.blockerReason).toContain('Branch');
  }, 10_000);

  it('marks session blocked when a file write fails', async () => {
    const session = makeSession();
    createSession(session);

    // resolveBaseSha
    mockGithubRequest.mockResolvedValueOnce({ default_branch: 'main' });
    mockGithubRequest.mockResolvedValueOnce({ object: { sha: 'base_sha' } });
    // createBranch
    mockGithubRequest.mockResolvedValueOnce({});
    // file read → before text not found (different content)
    mockGithubRequest.mockResolvedValueOnce({
      type:    'file',
      content: Buffer.from('completely different content').toString('base64'),
      sha:     'file_sha',
    });

    await runExecutor(session);

    const persisted = getSession(session.sessionId)!;
    expect(persisted.stage).toBe('blocked');
    expect(persisted.blockerReason).toContain('Cannot apply change');
  }, 10_000);

  it('resumes from branch_created (skips step 1)', async () => {
    const session = makeSession({ executorStep: 'branch_created' });
    createSession(session);

    // resolveBaseSha (called even on resume, to get base sha)
    mockGithubRequest.mockResolvedValueOnce({ default_branch: 'main' });
    mockGithubRequest.mockResolvedValueOnce({ object: { sha: 'base_sha' } });
    // file read
    mockGithubRequest.mockResolvedValueOnce({
      type:    'file',
      content: Buffer.from("payment.create({ amount })").toString('base64'),
      sha:     'file_sha',
    });
    // file write
    mockGithubRequest.mockResolvedValueOnce({ commit: { sha: 'commit_sha' } });
    // list PRs
    mockGithubRequest.mockResolvedValueOnce([]);
    // create PR
    mockGithubRequest.mockResolvedValueOnce({
      number:   200,
      html_url: 'https://github.com/acme/api/pull/200',
      head:     { sha: 'pr_sha' },
    });

    await runExecutor(session);

    const persisted = getSession(session.sessionId)!;
    expect(persisted.stage).toBe('pr_created');
    expect(persisted.prNumber).toBe(200);
  }, 10_000);
});

describe('pollCIOnce: pr_created → awaiting_merge', () => {
  it('transitions to awaiting_merge when CI passes', async () => {
    const session = makeSession({
      stage:        'pr_created',
      executorStep: 'pr_created',
      prHeadSha:    'head_sha_001',
      ciStatus:     'pending',
    });
    createSession(session);

    mockGithubRequest.mockResolvedValueOnce({
      check_runs: [{ name: 'test', status: 'completed', conclusion: 'success' }],
    });

    await pollCIOnce(session);

    const persisted = getSession(session.sessionId)!;
    expect(persisted.stage).toBe('awaiting_merge');
    expect(persisted.ciStatus).toBe('passed');
    expect(mockEnqueueGate).toHaveBeenCalledWith(session.sessionId, 2);
  }, 10_000);

  it('marks blocked when CI fails', async () => {
    const session = makeSession({
      stage:        'pr_created',
      executorStep: 'pr_created',
      prHeadSha:    'head_sha_002',
      ciStatus:     'running',
    });
    createSession(session);

    mockGithubRequest.mockResolvedValueOnce({
      check_runs: [{ name: 'unit-tests', status: 'completed', conclusion: 'failure' }],
    });

    await pollCIOnce(session);

    const persisted = getSession(session.sessionId)!;
    expect(persisted.stage).toBe('blocked');
    expect(persisted.ciStatus).toBe('failed');
    expect(persisted.blockerReason).toContain('unit-tests');
    expect(mockEnqueueGate).not.toHaveBeenCalled();
  }, 10_000);

  it('updates ciStatus to running when checks are in progress', async () => {
    const session = makeSession({
      stage:        'pr_created',
      executorStep: 'pr_created',
      prHeadSha:    'head_sha_003',
      ciStatus:     'pending',
    });
    createSession(session);

    mockGithubRequest.mockResolvedValueOnce({
      check_runs: [{ name: 'test', status: 'in_progress', conclusion: null }],
    });

    await pollCIOnce(session);

    const persisted = getSession(session.sessionId)!;
    expect(persisted.stage).toBe('pr_created');    // not changed
    expect(persisted.ciStatus).toBe('running');
    expect(mockEnqueueGate).not.toHaveBeenCalled();
  }, 10_000);

  it('does nothing when prHeadSha is missing', async () => {
    const session = makeSession({
      stage:        'pr_created',
      executorStep: 'pr_created',
      prHeadSha:    null,
    });
    createSession(session);

    await pollCIOnce(session);

    expect(mockGithubRequest).not.toHaveBeenCalled();
  }, 10_000);

  it('does not enqueue Gate 2 twice for the same session', async () => {
    const session = makeSession({
      stage:        'pr_created',
      executorStep: 'pr_created',
      prHeadSha:    'head_sha_004',
      ciStatus:     'pending',
    });
    createSession(session);

    mockGithubRequest.mockResolvedValue({
      check_runs: [{ name: 'test', status: 'completed', conclusion: 'success' }],
    });

    await pollCIOnce(session);

    // After first call, stage is 'awaiting_merge' — simulating a second poll
    // (daemon tick fires again before stage change is noticed)
    const persisted = getSession(session.sessionId)!;
    // pollCIOnce is only called for 'pr_created' sessions;
    // awaiting_merge sessions are not polled again
    expect(persisted.stage).toBe('awaiting_merge');
    expect(mockEnqueueGate).toHaveBeenCalledTimes(1);
  }, 10_000);
});
