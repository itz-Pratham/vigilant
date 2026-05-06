// tests/unit/ci-monitor.test.ts
// Unit tests for src/executor/ci-monitor.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGithubRequest = vi.fn();

vi.mock('../../src/lib/github.js', () => ({
  getGitHub:     vi.fn(),
  githubRequest: (...args: unknown[]) => mockGithubRequest(...args),
}));

import { checkCIStatus } from '../../src/executor/ci-monitor.js';

beforeEach(() => vi.clearAllMocks());

function makeCheckRun(name: string, status: string, conclusion: string | null) {
  return { name, status, conclusion };
}

describe('checkCIStatus', () => {
  it('returns pending when no check runs exist yet', async () => {
    mockGithubRequest.mockResolvedValueOnce({ check_runs: [] });
    const result = await checkCIStatus('acme', 'api', 'abc123');
    expect(result.status).toBe('pending');
  });

  it('returns running when any check run is in_progress', async () => {
    mockGithubRequest.mockResolvedValueOnce({
      check_runs: [
        makeCheckRun('build', 'completed', 'success'),
        makeCheckRun('test',  'in_progress', null),
      ],
    });
    const result = await checkCIStatus('acme', 'api', 'abc123');
    expect(result.status).toBe('running');
  });

  it('returns running when any check run is queued', async () => {
    mockGithubRequest.mockResolvedValueOnce({
      check_runs: [makeCheckRun('test', 'queued', null)],
    });
    const result = await checkCIStatus('acme', 'api', 'abc123');
    expect(result.status).toBe('running');
  });

  it('returns success when all check runs have passed', async () => {
    mockGithubRequest.mockResolvedValueOnce({
      check_runs: [
        makeCheckRun('build', 'completed', 'success'),
        makeCheckRun('lint',  'completed', 'success'),
        makeCheckRun('test',  'completed', 'neutral'),
      ],
    });
    const result = await checkCIStatus('acme', 'api', 'abc123');
    expect(result.status).toBe('success');
  });

  it('returns success when some checks are skipped', async () => {
    mockGithubRequest.mockResolvedValueOnce({
      check_runs: [
        makeCheckRun('build', 'completed', 'success'),
        makeCheckRun('deploy-preview', 'completed', 'skipped'),
      ],
    });
    const result = await checkCIStatus('acme', 'api', 'abc123');
    expect(result.status).toBe('success');
  });

  it('returns failure when any check run failed', async () => {
    mockGithubRequest.mockResolvedValueOnce({
      check_runs: [
        makeCheckRun('build', 'completed', 'success'),
        makeCheckRun('test',  'completed', 'failure'),
      ],
    });
    const result = await checkCIStatus('acme', 'api', 'abc123');
    expect(result.status).toBe('failure');
    expect(result.failedJob).toBe('test');
  });

  it('returns failure on timed_out conclusion', async () => {
    mockGithubRequest.mockResolvedValueOnce({
      check_runs: [makeCheckRun('slow-test', 'completed', 'timed_out')],
    });
    const result = await checkCIStatus('acme', 'api', 'abc123');
    expect(result.status).toBe('failure');
    expect(result.failedJob).toBe('slow-test');
  });

  it('returns failure on cancelled conclusion', async () => {
    mockGithubRequest.mockResolvedValueOnce({
      check_runs: [makeCheckRun('ci', 'completed', 'cancelled')],
    });
    const result = await checkCIStatus('acme', 'api', 'abc123');
    expect(result.status).toBe('failure');
  });

  it('returns failure on action_required conclusion', async () => {
    mockGithubRequest.mockResolvedValueOnce({
      check_runs: [makeCheckRun('security-scan', 'completed', 'action_required')],
    });
    const result = await checkCIStatus('acme', 'api', 'abc123');
    expect(result.status).toBe('failure');
  });

  it('returns pending when Checks API throws (no access)', async () => {
    mockGithubRequest.mockRejectedValueOnce(new Error('Resource not accessible'));
    const result = await checkCIStatus('acme', 'api', 'abc123');
    expect(result.status).toBe('pending');
  });
});
