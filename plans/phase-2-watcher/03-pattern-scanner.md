# Phase 2 — Pattern Scanner

**File:** `src/watcher/scanners/pattern-scanner.ts`

## Objective

Use the GitHub Search API to grep the entire repository codebase for domain-specific anti-patterns. This scanner is different from the others: it does not react to new PRs or commits — it proactively searches the full codebase for violations that already exist. This is what makes vigilant proactive rather than reactive.

---

## GitHub API Used

```
GET /search/code
  ?q={searchQuery}+repo:{owner}/{repo}
  &per_page=30
  Headers: (no ETag — search API does not support conditional requests)
```

**Rate limit note:** The Search API has a stricter limit: 30 requests per minute (vs 5000/hour for other endpoints). The pattern scanner runs at most once every 5 minutes (configurable) and uses at most 1 request per domain rule per tick.

---

## Full Implementation

```typescript
import type { ScanResult, DetectedIssue, PatternRule } from '@/watcher/types';
import { githubRequest } from '@/lib/github';
import { getWatcherState, upsertWatcherState } from '@/db/queries/watcher';
import { info } from '@/lib/logger';

const PATTERN_SCANNER_MIN_INTERVAL_MINUTES = 5;

export async function scanPatterns(params: {
  owner: string;
  repo: string;
  domain: string;
  patternRules: PatternRule[];
}): Promise<ScanResult> {
  const { owner, repo, domain, patternRules } = params;
  const scannerName = 'pattern-scanner';
  const state = getWatcherState(owner, repo, scannerName);

  // Only run every 5 minutes to stay within Search API rate limits
  if (state?.lastCheckedAt) {
    const minutesSinceLastCheck =
      (Date.now() - new Date(state.lastCheckedAt).getTime()) / 60_000;
    if (minutesSinceLastCheck < PATTERN_SCANNER_MIN_INTERVAL_MINUTES) {
      return { scanner: scannerName, issues: [], notModified: true };
    }
  }

  const issues: DetectedIssue[] = [];

  // Run one search per pattern rule (rate-limit budget: 1 per rule per 5 min)
  for (const rule of patternRules) {
    if (!rule.searchQuery) continue;

    const searchQuery = `${rule.searchQuery} repo:${owner}/${repo}`;

    let searchResults;
    try {
      searchResults = await githubRequest(
        octokit => octokit.rest.search.code({ q: searchQuery, per_page: 10 }),
        'watcher'
      );
    } catch {
      // Search API may 422 on some queries — skip gracefully
      continue;
    }

    for (const item of searchResults.data.items) {
      // Apply file path filter if the rule has one
      if (rule.filePathPattern) {
        const regex = new RegExp(rule.filePathPattern);
        if (!regex.test(item.path)) continue;
      }

      issues.push({
        issueType: rule.issueType,
        severity: rule.severity,
        confidence: rule.confidenceScore * 0.85, // slightly lower confidence for static grep vs diff analysis
        sourceRef: `file:${item.path}`,
        evidence: [
          `File: ${item.path}`,
          `Repository search matched: ${rule.description}`,
          `Search query: ${rule.searchQuery}`,
        ],
        domain,
        repoOwner: owner,
        repoName: repo,
        detectedAt: new Date().toISOString(),
      });

      info(
        `Pattern scanner found ${rule.issueType} in ${item.path}`,
        'watcher',
        { rule: rule.id, file: item.path }
      );
    }

    // Small delay between search requests to avoid hitting the 30/min limit
    await sleep(2000);
  }

  upsertWatcherState({
    repoOwner: owner, repoName: repo, scannerName,
    lastEtag: null, lastCheckedAt: new Date().toISOString()
  });

  return { scanner: scannerName, issues };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## Why This Scanner Matters

The PR and commit scanners only catch new bugs being introduced. The pattern scanner catches bugs that already exist in the codebase — the technical debt that pre-dates vigilant's installation. On first run, this scanner is likely to find the most issues.
