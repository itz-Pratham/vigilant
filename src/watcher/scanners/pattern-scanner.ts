// src/watcher/scanners/pattern-scanner.ts
// Runs GitHub Search API queries from domain pack pattern rules.
// Rate-limited to one run per PATTERN_SCAN_MIN_INTERVAL_SECONDS (5 minutes).

import { githubRequest } from '../../lib/github.js';
import { debug, warn } from '../../lib/logger.js';
import { PATTERN_SCAN_MIN_INTERVAL_SECONDS } from '../../lib/constants.js';
import type { ScanResult, DetectedIssue } from '../types.js';
import type { DomainPack } from '../../agent/domain-context.js';

type SearchCodeItem = {
  path:       string;
  html_url:   string;
  repository: { full_name: string };
};

/** In-memory timestamp of last pattern scan. */
let lastPatternScanAt = 0;

export async function scanPatterns(params: {
  owner:       string;
  repo:        string;
  activePacks: DomainPack[];
}): Promise<ScanResult> {
  const { owner, repo, activePacks } = params;
  const scanner = 'pattern-scanner';

  // Enforce rate-limit interval
  const now     = Date.now();
  const elapsed = (now - lastPatternScanAt) / 1000;
  if (elapsed < PATTERN_SCAN_MIN_INTERVAL_SECONDS) {
    debug(
      `Pattern scan skipped — ${Math.round(PATTERN_SCAN_MIN_INTERVAL_SECONDS - elapsed)}s until next allowed`,
      scanner,
    );
    return { scanner, issues: [] };
  }

  lastPatternScanAt = now;
  const issues: DetectedIssue[] = [];

  for (const pack of activePacks) {
    for (const rule of pack.patternRules) {
      const query = `${rule.searchQuery} repo:${owner}/${repo}`;

      let items: SearchCodeItem[];
      try {
        const response = await githubRequest(
          (octokit) =>
            octokit.request('GET /search/code', {
              q:        query,
              per_page: 20,
            }).then(r => r.data),
          scanner,
        ) as { items: SearchCodeItem[]; total_count: number };
        items = response.items;
      } catch (err) {
        warn(`Search query failed for rule ${rule.id}: ${query}`, scanner, err as Record<string, unknown>);
        continue;
      }

      if (items.length === 0) continue;

      // Apply optional file path filter
      const filteredItems = rule.filePathPattern
        ? items.filter(item => new RegExp(rule.filePathPattern!, 'i').test(item.path))
        : items;

      if (filteredItems.length === 0) continue;

      debug(`Rule ${rule.id} matched ${filteredItems.length} files`, scanner);

      issues.push({
        repoOwner:   owner,
        repoName:    repo,
        domain:      pack.id,
        issueType:   rule.issueType,
        severity:    rule.severity,
        confidence:  rule.confidenceScore,
        sourceRef:   `search:${rule.id}`,
        evidence:    filteredItems.slice(0, 5).map(i => i.path),
        description: `${rule.description} — ${filteredItems.length} matching file(s) found`,
        detectedAt:  new Date().toISOString(),
      });
    }
  }

  return { scanner, issues };
}
