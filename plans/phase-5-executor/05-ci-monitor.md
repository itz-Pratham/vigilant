# Phase 5 — CI Monitor

**File:** `src/executor/ci-monitor.ts`

## Objective

After the PR is created, poll GitHub Actions until all check runs complete or the timeout is hit. Returns `success`, `failure`, or `timed_out`. Session transitions to `awaiting_merge` on success, `blocked` on failure/timeout.

---

## Implementation

```typescript
// src/executor/ci-monitor.ts
import { Octokit }        from '@octokit/rest';
import { CICheckResult }  from './types.js';

const POLL_INTERVAL_MS  = 60_000;  // 60 seconds
const TIMEOUT_MS        = 30 * 60_000; // 30 minutes

/**
 * Polls Actions runs for `prHeadSha` until all complete or timeout.
 * Resolves with CICheckResult.
 */
export async function monitorCI(
  octokit:    Octokit,
  owner:      string,
  repo:       string,
  prHeadSha:  string,
): Promise<CICheckResult> {
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    const result = await pollOnce(octokit, owner, repo, prHeadSha);

    if (result.status === 'pending') {
      // Still running — wait and poll again
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    return result;
  }

  // Timeout
  return {
    status:    'failure',
    runId:     0,
    runUrl:    '',
    failedJob: 'CI monitoring timed out after 30 minutes',
  };
}

async function pollOnce(
  octokit:   Octokit,
  owner:     string,
  repo:      string,
  headSha:   string,
): Promise<CICheckResult> {
  const { data } = await octokit.actions.listWorkflowRunsForRepo({
    owner,
    repo,
    head_sha: headSha,
    per_page: 20,
  });

  const runs = data.workflow_runs;

  // No runs yet — CI hasn't triggered
  if (runs.length === 0) {
    return { status: 'pending', runId: 0, runUrl: '' };
  }

  const inProgress = runs.some(r => r.status === 'in_progress' || r.status === 'queued');
  if (inProgress) {
    return { status: 'pending', runId: runs[0].id, runUrl: runs[0].html_url };
  }

  // All runs completed — check for failures
  const failed = runs.find(r => r.conclusion === 'failure' || r.conclusion === 'cancelled');

  if (failed) {
    const failedJob = await getFirstFailedJobName(octokit, owner, repo, failed.id);
    return {
      status:    'failure',
      runId:     failed.id,
      runUrl:    failed.html_url,
      failedJob,
    };
  }

  // All success
  return { status: 'success', runId: runs[0].id, runUrl: runs[0].html_url };
}

async function getFirstFailedJobName(
  octokit: Octokit,
  owner:   string,
  repo:    string,
  runId:   number,
): Promise<string> {
  try {
    const { data } = await octokit.actions.listJobsForWorkflowRun({
      owner, repo, run_id: runId, per_page: 20,
    });
    const failedJob = data.jobs.find(j => j.conclusion === 'failure');
    return failedJob?.name ?? 'unknown job';
  } catch {
    return 'unknown job';
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
```

---

## State Transition Table

| CI Outcome | Session Stage | `ciStatus` in SQLite |
|---|---|---|
| All runs pass | `awaiting_merge` | `passed` |
| Any run fails | `blocked` | `failed` |
| 30-min timeout | `blocked` | `failed` |
| No runs appear within first 5 polls | Continue polling | `pending` |

---

## Rate Limit Note

30-minute timeout at 60s intervals = max 30 polls per session. GitHub REST: 5000/hr budget. Even 10 concurrent sessions = 300 polling calls/hr — well within limits.
