// src/executor/ci-monitor.ts
// Checks the CI status for a PR's head commit using the GitHub Checks API.
// Returns a single snapshot — no polling loop.
// Called once per daemon tick for sessions in 'pr_created' stage.

import { githubRequest } from '../lib/github.js';
import type { CICheckResult } from './types.js';

// Conclusions that count as a failure (not neutral, skipped, or success)
const FAILURE_CONCLUSIONS = new Set(['failure', 'timed_out', 'action_required', 'cancelled']);

/**
 * Fetches the current check-run status for a PR head SHA.
 * Returns a snapshot — the daemon tick calls this periodically.
 *
 * Uses the Checks API (listForRef) rather than workflow runs because it:
 * - Correctly handles reruns (shows latest status per check, not all historical runs)
 * - Avoids false failures from cancelled/stale workflow runs
 * - Works with both GitHub Actions and third-party CI providers
 */
export async function checkCIStatus(
  owner:     string,
  repo:      string,
  prHeadSha: string,
): Promise<CICheckResult> {
  let checkRuns: Array<{ name: string; status: string; conclusion: string | null }>;

  try {
    const data = await githubRequest(
      (octokit) => octokit.checks.listForRef({
        owner,
        repo,
        ref:      prHeadSha,
        per_page: 100,
      }).then(r => r.data),
      'executor',
    );
    checkRuns = data.check_runs as Array<{ name: string; status: string; conclusion: string | null }>;
  } catch {
    // Checks API unavailable (e.g. repo has no Actions) — stay pending
    return { status: 'pending' };
  }

  if (checkRuns.length === 0) {
    // No checks registered yet — CI hasn't triggered
    return { status: 'pending' };
  }

  const anyInProgress = checkRuns.some(
    r => r.status === 'queued' || r.status === 'in_progress',
  );
  if (anyInProgress) {
    return { status: 'running' };
  }

  // All checks completed — look for any failure
  const failed = checkRuns.find(
    r => r.conclusion !== null && FAILURE_CONCLUSIONS.has(r.conclusion),
  );

  if (failed) {
    return { status: 'failure', failedJob: failed.name };
  }

  return { status: 'success' };
}
