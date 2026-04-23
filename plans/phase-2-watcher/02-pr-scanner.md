# Phase 2 — PR Scanner

**File:** `src/watcher/scanners/pr-scanner.ts`

## Objective

Scan open and recently updated pull requests for the watched repo. For each PR that touches files matching the domain pack's `watchedFilePaths` patterns, pass the PR diff to the pattern rules for analysis. If any pattern rule matches, emit a `DetectedIssue`.

---

## GitHub API Used

```
GET /repos/{owner}/{repo}/pulls
  ?state=open
  &sort=updated
  &direction=desc
  &per_page=30
  Headers: If-None-Match: {lastEtag}
```

For each PR that passes the file path filter:
```
GET /repos/{owner}/{repo}/pulls/{pull_number}/files
  Headers: If-None-Match: {lastEtagForPR}
```

---

## Full Implementation

```typescript
import type { ScanResult, DetectedIssue, PatternRule } from '@/watcher/types';
import { conditionalGet, githubRequest } from '@/lib/github';
import { getWatcherState, upsertWatcherState } from '@/db/queries/watcher';
import { info } from '@/lib/logger';
import { minimatch } from 'minimatch';   // npm: minimatch

export async function scanPRs(params: {
  owner: string;
  repo: string;
  domain: string;
  patternRules: PatternRule[];
}): Promise<ScanResult> {
  const { owner, repo, domain, patternRules } = params;
  const scannerName = 'pr-scanner';
  const state = getWatcherState(owner, repo, scannerName);

  // Collect all watchedFilePaths from all rules
  const watchedPaths = patternRules.flatMap(r => r.watchedFilePaths ?? []);

  const result = await conditionalGet({
    endpoint: `/repos/${owner}/${repo}/pulls`,
    octokitFn: (headers) =>
      githubRequest(octokit =>
        octokit.rest.pulls.list({
          owner, repo,
          state: 'open',
          sort: 'updated',
          direction: 'desc',
          per_page: 30,
          headers,
        } as Parameters<typeof octokit.rest.pulls.list>[0])
      ),
    lastEtag: state?.lastEtag ?? null,
    context: 'watcher',
  });

  if (!result) {
    // 304 Not Modified
    return { scanner: scannerName, issues: [], notModified: true };
  }

  const { data: prs, etag } = result;
  const issues: DetectedIssue[] = [];

  for (const pr of prs) {
    // Get files changed in this PR
    const filesResult = await githubRequest(
      octokit => octokit.rest.pulls.listFiles({
        owner, repo, pull_number: pr.number, per_page: 100
      })
    );

    const changedPaths = filesResult.data.map(f => f.filename);

    // Check if any changed file matches our watched paths
    const relevantFiles = changedPaths.filter(filePath =>
      watchedPaths.some(pattern => minimatch(filePath, pattern))
    );

    if (relevantFiles.length === 0) continue;

    // For each relevant file, fetch its content and check pattern rules
    for (const filePath of relevantFiles) {
      const fileData = filesResult.data.find(f => f.filename === filePath);
      if (!fileData?.patch) continue;

      for (const rule of patternRules) {
        const match = checkPatternInPatch(fileData.patch, rule);
        if (!match) continue;

        issues.push({
          issueType: rule.issueType,
          severity: rule.severity,
          confidence: rule.confidenceScore,
          sourceRef: `PR#${pr.number}`,
          evidence: [
            `File: ${filePath}`,
            `PR: ${pr.title} by @${pr.user?.login ?? 'unknown'}`,
            `Matched rule: ${rule.description}`,
            ...match.matchedLines.slice(0, 3),
          ],
          domain,
          repoOwner: owner,
          repoName: repo,
          detectedAt: new Date().toISOString(),
        });

        info(
          `PR scanner found ${rule.issueType} in PR#${pr.number} at ${filePath}`,
          'watcher',
          { rule: rule.id, pr: pr.number, file: filePath }
        );

        break;   // one issue per file per tick — don't spam with duplicates
      }
    }
  }

  // Save new ETag
  upsertWatcherState({ repoOwner: owner, repoName: repo, scannerName, lastEtag: etag, lastCheckedAt: new Date().toISOString() });

  return { scanner: scannerName, issues, newEtag: etag };
}

// ── Helpers ───────────────────────────────────────────────────────────

type PatternMatch = { matchedLines: string[] };

/**
 * Check if the given PR file patch matches the pattern rule.
 * For the PR scanner, we do a simple text search on the diff content.
 * More sophisticated AST analysis happens in the agent's investigation phase.
 */
function checkPatternInPatch(patch: string, rule: PatternRule): PatternMatch | null {
  // Check if the file path matches the rule's path filter
  // (already filtered above, but double-check for path-specific rules)
  if (rule.filePathPattern) {
    // rule.filePathPattern is checked by the caller — skip here
  }

  // Simple heuristic: check if the search query keywords appear in the diff
  // This is intentionally loose — the agent does the precise analysis
  const keywords = extractKeywordsFromQuery(rule.searchQuery);
  const patchLines = patch.split('\n').filter(l => l.startsWith('+'));

  const matchedLines = patchLines.filter(line =>
    keywords.some(kw => line.toLowerCase().includes(kw.toLowerCase()))
  );

  if (matchedLines.length > 0) {
    return { matchedLines };
  }

  return null;
}

function extractKeywordsFromQuery(query: string): string[] {
  // Extract quoted strings and unquoted words from a GitHub search query
  const quoted = [...query.matchAll(/"([^"]+)"/g)].map(m => m[1]);
  const unquoted = query.replace(/"[^"]*"/g, '').trim().split(/\s+/).filter(Boolean);
  return [...quoted, ...unquoted].filter(w => !['language:typescript', 'language:javascript', 'NOT', 'AND', 'OR'].includes(w));
}
```
