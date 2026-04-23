# Phase 2 — Commit Scanner

**File:** `src/watcher/scanners/commit-scanner.ts`

## Objective

Scan recent commits on the default branch for anti-pattern signatures in commit diffs. Complements the PR scanner — catches merged code that was never reviewed via an open PR (direct pushes, merge commits).

---

## GitHub API Used

```
GET /repos/{owner}/{repo}/commits
  ?per_page=20
  &sha={defaultBranch}
  Headers: If-None-Match: {lastEtag}

GET /repos/{owner}/{repo}/commits/{sha}
  (for each commit that passes the file path filter — full diff)
```

---

## Implementation

```typescript
import type { ScanResult, DetectedIssue, PatternRule } from '@/watcher/types';
import { conditionalGet, githubRequest }                from '@/lib/github';
import { getWatcherState, upsertWatcherState }          from '@/db/queries/watcher';
import { info }                                         from '@/lib/logger';
import { minimatch }                                    from 'minimatch';
import { COMMIT_SCAN_PER_PAGE }                         from '@/lib/constants';

export async function scanCommits(params: {
  owner: string;
  repo: string;
  defaultBranch: string;
  patternRules: PatternRule[];
}): Promise<ScanResult> {
  const { owner, repo, defaultBranch, patternRules } = params;
  const scannerKey = `commit-scanner:${owner}/${repo}`;
  const state = getWatcherState(owner, repo, 'commit-scanner');

  const listResponse = await conditionalGet(
    `/repos/${owner}/${repo}/commits`,
    { sha: defaultBranch, per_page: COMMIT_SCAN_PER_PAGE },
    state?.lastEtag,
  );

  if (listResponse.notModified) {
    return { scanner: 'commit-scanner', issues: [], notModified: true };
  }

  const commits = listResponse.data as Array<{ sha: string; commit: { message: string } }>;
  const issues: DetectedIssue[] = [];

  // Collect watchedFilePaths from all rules to build a union filter
  const watchedGlobs = [...new Set(patternRules.flatMap(r => r.watchedFilePaths ?? []))];

  for (const commit of commits) {
    // Fetch full diff for this commit
    const diffResponse = await githubRequest(`/repos/${owner}/${repo}/commits/${commit.sha}`, {
      headers: { Accept: 'application/vnd.github.v3.diff' },
    });

    const patch = diffResponse.data as string;

    // Check whether any changed file matches the domain's watched paths
    const touchesDomainFile = watchedGlobs.length === 0
      || watchedGlobs.some(glob => minimatch(patch, glob, { matchBase: true }));

    if (!touchesDomainFile) continue;

    // Check each pattern rule against the patch text
    for (const rule of patternRules) {
      if (!matchesPattern(patch, rule)) continue;

      issues.push({
        issueType:   rule.issueType,
        severity:    rule.severity,
        confidence:  rule.confidenceScore,
        sourceRef:   `commit:${commit.sha.slice(0, 7)}`,
        evidence:    extractEvidenceLines(patch, rule.searchQuery),
        domain:      rule.id.split('-')[0],
        repoOwner:   owner,
        repoName:    repo,
        detectedAt:  new Date().toISOString(),
      });
      break; // one issue per commit per rule is enough
    }
  }

  upsertWatcherState(owner, repo, 'commit-scanner', listResponse.etag ?? null);
  info(`commit-scanner: ${commits.length} commits checked, ${issues.length} issues found`, 'watcher');

  return { scanner: 'commit-scanner', issues, newEtag: listResponse.etag };
}

function matchesPattern(patch: string, rule: PatternRule): boolean {
  const queryTerms = rule.searchQuery
    .split(/\s+/)
    .filter(t => !t.startsWith('language:') && !t.startsWith('NOT ') && t.length > 2);
  return queryTerms.some(term => patch.includes(term));
}

function extractEvidenceLines(patch: string, query: string): string[] {
  const terms = query.split(/\s+/).filter(t => t.length > 2);
  return patch
    .split('\n')
    .filter(line => line.startsWith('+') && terms.some(t => line.includes(t)))
    .slice(0, 5); // at most 5 evidence lines
}
```
