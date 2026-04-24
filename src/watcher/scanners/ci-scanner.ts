// src/watcher/scanners/ci-scanner.ts
// Scans failed GitHub Actions workflow runs for domain-relevant job failures.

import { conditionalGet } from '../../lib/github.js';
import { warn, debug } from '../../lib/logger.js';
import type { ScanResult, DetectedIssue } from '../types.js';
import type { DomainPack } from '../../agent/domain-context.js';
import { resolveCIIssueType } from '../../agent/domain-context.js';
import type { Octokit } from '@octokit/rest';

type WorkflowRun = {
  id:          number;
  name?:       string;
  conclusion:  string | null;
  html_url:    string;
  head_sha:    string;
  updated_at:  string;
};
type WorkflowJob = {
  id:         number;
  name:       string;
  conclusion: string | null;
  html_url:   string;
  steps?:     Array<{ name: string; conclusion: string | null }>;
};

export async function scanCI(params: {
  owner:       string;
  repo:        string;
  activePacks: DomainPack[];
  lastEtag:    string | null;
}): Promise<ScanResult> {
  const { owner, repo, activePacks, lastEtag } = params;
  const scanner = 'ci-scanner';

  // Fetch recent workflow runs
  const result = await conditionalGet<{ workflow_runs: WorkflowRun[] }>({
    fn: async (octokit: Octokit, extraHeaders) => {
      return octokit.request('GET /repos/{owner}/{repo}/actions/runs', {
        owner,
        repo,
        per_page: 30,
        status:   'failure',
        headers:  extraHeaders,
      }) as Promise<{ data: { workflow_runs: WorkflowRun[] }; headers: Record<string, string | number | undefined>; status: number }>;
    },
    lastEtag,
    context: scanner,
  });

  if (!result) {
    return { scanner, issues: [], notModified: true };
  }

  const { data, etag: newEtag } = result;
  const runs   = data.workflow_runs;
  const issues: DetectedIssue[] = [];

  for (const run of runs) {
    // Fetch jobs for this run
    let jobs: WorkflowJob[];
    try {
      const jobsResult = await conditionalGet<{ jobs: WorkflowJob[] }>({
        fn: async (octokit: Octokit, extraHeaders) => {
          return octokit.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs', {
            owner,
            repo,
            run_id:  run.id,
            headers: extraHeaders,
          }) as Promise<{ data: { jobs: WorkflowJob[] }; headers: Record<string, string | number | undefined>; status: number }>;
        },
        lastEtag: null,
        context:  `${scanner}:run-${run.id}`,
      });
      if (!jobsResult) continue;
      jobs = jobsResult.data.jobs;
    } catch (err) {
      warn(`Failed to fetch jobs for run ${run.id}`, scanner, err as Record<string, unknown>);
      continue;
    }

    const failedJobs = jobs.filter(j => j.conclusion === 'failure');

    for (const job of failedJobs) {
      const jobNameLower = job.name.toLowerCase();

      for (const pack of activePacks) {
        // Check whether job name contains any CI keywords for this pack
        const keywordMatched = pack.ciKeywords.some(kw => jobNameLower.includes(kw));
        if (!keywordMatched) continue;

        const issueType = resolveCIIssueType('CI_DOMAIN_FAILURE', pack);

        debug(`Failed CI job "${job.name}" matches pack "${pack.id}"`, scanner);

        issues.push({
          repoOwner:   owner,
          repoName:    repo,
          domain:      pack.id,
          issueType,
          severity:    'HIGH',
          confidence:  0.9,
          sourceRef:   `ci:${run.id}:${job.id}`,
          evidence:    [
            `Workflow run: ${run.html_url}`,
            `Failed job: ${job.name}`,
            ...(job.steps ?? []).filter(s => s.conclusion === 'failure').map(s => `Step failed: ${s.name}`),
          ],
          description: `CI job "${job.name}" failed in run ${run.id} — ${pack.name} domain detected`,
          detectedAt:  new Date().toISOString(),
        });
      }
    }
  }

  return { scanner, issues, newEtag };
}
