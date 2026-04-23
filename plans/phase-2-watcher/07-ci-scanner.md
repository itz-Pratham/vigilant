# Phase 2 — CI Scanner

**File:** `src/watcher/scanners/ci-scanner.ts`

## Objective

Poll GitHub Actions workflow runs for the watched repo. If a run has failed and its job names contain domain keywords (e.g. "payment", "checkout"), emit a `CI_PAYMENT_FAILURE` (or equivalent) `DetectedIssue`. This surfaces test failures that indicate a broken domain-critical path.

---

## GitHub API Used

```
GET /repos/{owner}/{repo}/actions/runs
  ?status=failure
  &per_page=10
  Headers: If-None-Match: {lastEtag}

GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs
  (for each failed run — to inspect job names)
```

---

## Implementation

```typescript
import type { ScanResult, DetectedIssue, PatternRule } from '@/watcher/types';
import { conditionalGet, githubRequest }                from '@/lib/github';
import { getWatcherState, upsertWatcherState }          from '@/db/queries/watcher';
import { info }                                         from '@/lib/logger';

type WorkflowRun = {
  id: number;
  name: string;
  conclusion: string | null;
  html_url: string;
  head_sha: string;
};

type WorkflowJob = {
  id: number;
  name: string;
  conclusion: string | null;
};

export async function scanCI(params: {
  owner: string;
  repo: string;
  ciKeywords: string[];   // from active DomainPack — e.g. ['payment', 'checkout', 'billing']
  patternRules: PatternRule[];
}): Promise<ScanResult> {
  const { owner, repo, ciKeywords } = params;
  const state = getWatcherState(owner, repo, 'ci-scanner');

  const runsResponse = await conditionalGet(
    `/repos/${owner}/${repo}/actions/runs`,
    { status: 'failure', per_page: 10 },
    state?.lastEtag,
  );

  if (runsResponse.notModified) {
    return { scanner: 'ci-scanner', issues: [], notModified: true };
  }

  const runs = (runsResponse.data as { workflow_runs: WorkflowRun[] }).workflow_runs;
  const issues: DetectedIssue[] = [];

  for (const run of runs) {
    if (run.conclusion !== 'failure') continue;

    // Fetch jobs to check names against domain keywords
    const jobsResponse = await githubRequest(
      `/repos/${owner}/${repo}/actions/runs/${run.id}/jobs`,
    );
    const jobs = (jobsResponse.data as { jobs: WorkflowJob[] }).jobs;

    const matchingJob = jobs.find(
      j => j.conclusion === 'failure'
        && ciKeywords.some(kw => j.name.toLowerCase().includes(kw.toLowerCase())),
    );

    if (!matchingJob) continue;

    issues.push({
      issueType:  'CI_DOMAIN_FAILURE',     // each domain pack maps this to its own type e.g. CI_PAYMENT_FAILURE
      severity:   'HIGH',
      confidence: 0.9,
      sourceRef:  `run:${run.id}/job:${matchingJob.id}`,
      evidence:   [
        `Workflow run: ${run.name}`,
        `Failed job: ${matchingJob.name}`,
        `Run URL: ${run.html_url}`,
      ],
      domain:     ciKeywords[0] ?? 'unknown', // first keyword hints at domain
      repoOwner:  owner,
      repoName:   repo,
      detectedAt: new Date().toISOString(),
    });
  }

  upsertWatcherState(owner, repo, 'ci-scanner', runsResponse.etag ?? null);
  info(`ci-scanner: ${runs.length} failed runs checked, ${issues.length} domain failures found`, 'watcher');

  return { scanner: 'ci-scanner', issues, newEtag: runsResponse.etag };
}
```

---

## CI Issue Type Mapping

The generic `CI_DOMAIN_FAILURE` issueType emitted here is resolved to the domain-specific type by the daemon loop before handing it to the agent:

```typescript
// src/watcher/index.ts — after collecting ScanResults
function resolveCIIssueType(issue: DetectedIssue, pack: DomainPack): DetectedIssue {
  if (issue.issueType !== 'CI_DOMAIN_FAILURE') return issue;
  const ciType = pack.issueTypes.find(t => t.startsWith('CI_')) ?? 'CI_DOMAIN_FAILURE';
  return { ...issue, issueType: ciType, domain: pack.id };
}
```
