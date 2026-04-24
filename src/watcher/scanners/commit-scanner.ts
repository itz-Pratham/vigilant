// src/watcher/scanners/commit-scanner.ts
// Scans recent commits for file changes matching domain pack anti-patterns.

import { conditionalGet } from '../../lib/github.js';
import { warn, debug } from '../../lib/logger.js';
import type { ScanResult, DetectedIssue } from '../types.js';
import type { DomainPack } from '../../agent/domain-context.js';
import type { Octokit } from '@octokit/rest';
import { minimatch } from 'minimatch';

type CommitSummary = { sha: string; commit: { message: string }; html_url: string };
type CommitDetail = {
  sha:    string;
  files?: Array<{ filename: string; patch?: string; additions: number; deletions: number }>;
};

const COMMITS_PER_TICK = 20;

export async function scanCommits(params: {
  owner:       string;
  repo:        string;
  activePacks: DomainPack[];
  lastEtag:    string | null;
}): Promise<ScanResult> {
  const { owner, repo, activePacks, lastEtag } = params;
  const scanner = 'commit-scanner';

  // Fetch recent commits with ETag
  const result = await conditionalGet<CommitSummary[]>({
    fn: async (octokit: Octokit, extraHeaders) => {
      return octokit.request('GET /repos/{owner}/{repo}/commits', {
        owner,
        repo,
        per_page: COMMITS_PER_TICK,
        headers:  extraHeaders,
      }) as Promise<{ data: CommitSummary[]; headers: Record<string, string | number | undefined>; status: number }>;
    },
    lastEtag,
    context: scanner,
  });

  if (!result) {
    return { scanner, issues: [], notModified: true };
  }

  const { data: commits, etag: newEtag } = result;
  const issues: DetectedIssue[] = [];

  for (const commit of commits) {
    let detail: CommitDetail;
    try {
      const detailResult = await conditionalGet<CommitDetail>({
        fn: async (octokit: Octokit, extraHeaders) => {
          return octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', {
            owner,
            repo,
            ref:     commit.sha,
            headers: extraHeaders,
          }) as Promise<{ data: CommitDetail; headers: Record<string, string | number | undefined>; status: number }>;
        },
        lastEtag: null,
        context:  `${scanner}:${commit.sha.slice(0, 7)}`,
      });
      if (!detailResult) continue;
      detail = detailResult.data;
    } catch (err) {
      warn(`Failed to fetch commit ${commit.sha.slice(0, 7)}`, scanner, err as Record<string, unknown>);
      continue;
    }

    const changedFiles = detail.files ?? [];
    const message      = commit.commit.message.toLowerCase();

    for (const pack of activePacks) {
      for (const rule of pack.patternRules) {
        const watchedGlobs = rule.watchedFilePaths ?? [];
        if (watchedGlobs.length === 0) continue;

        // Check if any changed file matches a watched glob
        const matchedFiles = changedFiles.filter(f =>
          watchedGlobs.some(glob => minimatch(f.filename, glob, { matchBase: true })),
        );
        if (matchedFiles.length === 0) continue;

        // Optional: check commit message for issue keywords
        const messageHint = message.includes('fix') || message.includes('patch') || message.includes('hotfix');

        debug(`Commit ${commit.sha.slice(0, 7)} touched ${rule.issueType} files`, scanner);

        issues.push({
          repoOwner:   owner,
          repoName:    repo,
          domain:      pack.id,
          issueType:   rule.issueType,
          severity:    rule.severity,
          // Boost confidence if commit message indicates a fix (may have introduced regression)
          confidence:  messageHint ? Math.min(rule.confidenceScore + 0.05, 1.0) : rule.confidenceScore,
          sourceRef:   `commit:${commit.sha}`,
          evidence:    matchedFiles.map(f => f.filename),
          description: `Commit ${commit.sha.slice(0, 7)} "${commit.commit.message.split('\n')[0]}" modifies ${pack.name}-domain files — ${rule.description}`,
          detectedAt:  new Date().toISOString(),
        });
      }
    }
  }

  return { scanner, issues, newEtag };
}
