// src/watcher/scanners/pr-scanner.ts
// Scans open pull requests for files matching domain pack watched paths.

import { minimatch } from 'minimatch';
import { conditionalGet } from '../../lib/github.js';
import { warn, debug } from '../../lib/logger.js';
import type { ScanResult, DetectedIssue } from '../types.js';
import type { DomainPack } from '../../agent/domain-context.js';
import type { Octokit } from '@octokit/rest';

type PRFile = { filename: string };
type PullRequest = { number: number; title: string; html_url: string; head: { sha: string } };

/**
 * Scan open PRs and flag those whose changed files match a domain pack's watched path globs.
 *
 * Uses ETag-based conditional GET for the PR list — returns notModified when GitHub says no change.
 * Individual PR file lists do NOT use ETags (list changes each tick as commits are pushed).
 */
export async function scanPRs(params: {
  owner:       string;
  repo:        string;
  activePacks: DomainPack[];
  lastEtag:    string | null;
}): Promise<ScanResult> {
  const { owner, repo, activePacks, lastEtag } = params;
  const scanner = 'pr-scanner';

  // Step 1 — fetch open PRs with ETag
  const result = await conditionalGet<PullRequest[]>({
    fn: async (octokit: Octokit, extraHeaders) => {
      return octokit.request('GET /repos/{owner}/{repo}/pulls', {
        owner,
        repo,
        state:    'open',
        per_page: 50,
        headers:  extraHeaders,
      }) as Promise<{ data: PullRequest[]; headers: Record<string, string | number | undefined>; status: number }>;
    },
    lastEtag,
    context: scanner,
  });

  if (!result) {
    return { scanner, issues: [], notModified: true };
  }

  const { data: prs, etag: newEtag } = result;
  const issues: DetectedIssue[] = [];

  // Step 2 — for each open PR, fetch its changed files and apply watched globs
  for (const pr of prs) {
    let files: PRFile[];
    try {
      const filesResult = await conditionalGet<PRFile[]>({
        fn: async (octokit: Octokit, extraHeaders) => {
          return octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
            owner,
            repo,
            pull_number: pr.number,
            per_page:    100,
            headers:     extraHeaders,
          }) as Promise<{ data: PRFile[]; headers: Record<string, string | number | undefined>; status: number }>;
        },
        lastEtag: null,
        context:  `${scanner}:pr-${pr.number}`,
      });
      files = filesResult?.data ?? [];
    } catch (err) {
      warn(`Failed to fetch files for PR #${pr.number}`, scanner, err as Record<string, unknown>);
      continue;
    }

    for (const pack of activePacks) {
      for (const rule of pack.patternRules) {
        const watchedGlobs = rule.watchedFilePaths ?? [];
        if (watchedGlobs.length === 0) continue;

        const matchedFiles = files.filter(f =>
          watchedGlobs.some(glob => minimatch(f.filename, glob, { matchBase: true })),
        );

        if (matchedFiles.length === 0) continue;

        debug(`PR #${pr.number} matched rule ${rule.id} (${matchedFiles.length} files)`, scanner);

        issues.push({
          repoOwner:   owner,
          repoName:    repo,
          domain:      pack.id,
          issueType:   rule.issueType,
          severity:    rule.severity,
          confidence:  rule.confidenceScore,
          sourceRef:   `pr:${pr.number}`,
          evidence:    matchedFiles.map(f => f.filename),
          description: `PR #${pr.number} "${pr.title}" modifies ${pack.name}-domain files — ${rule.description}`,
          detectedAt:  new Date().toISOString(),
        });
      }
    }
  }

  return { scanner, issues, newEtag };
}
