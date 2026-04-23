# Phase 2 — Watcher

## Goal

A daemon that runs on a configurable interval, scans a GitHub repo for issues across five scanners, deduplicates against existing sessions, and hands new detected issues to the agent. The watcher is the entry point for everything vigilant does — it is what "never stops."

## In Scope

- Five GitHub API scanners (PR, commit, CI, dependency, pattern)
- Pattern registry: per-domain `PatternRule` objects loaded from the active domain pack
- ETag conditional requests to minimise rate limit usage
- Deduplication: issues already tracked in SQLite are skipped
- Daemon loop: `setInterval` with exponential backoff on 403/429 errors
- `vigilant start --repo <owner/repo> [--domain <domain>] [--interval <seconds>]` command that keeps the process alive

## Out of Scope

- The agentic loop (Phase 3)
- HITL gates (Phase 4)
- The learning mode (Phase 6)

## File Structure Created

```
src/
├── watcher/
│   ├── index.ts              ← daemon loop, orchestrates all scanners
│   ├── types.ts              ← WatcherTick, DetectedIssue, ScanResult, PatternRule
│   ├── scanners/
│   │   ├── pr-scanner.ts     ← scans open/updated PRs
│   │   ├── commit-scanner.ts ← scans recent commits for anti-patterns
│   │   ├── ci-scanner.ts     ← scans GitHub Actions for payment test failures
│   │   ├── dep-scanner.ts    ← compares package.json vs latest SDK releases
│   │   └── pattern-scanner.ts← GitHub Search API grep over repo code
│   └── pattern-registry.ts   ← loads PatternRule list from active domain pack
```

## Core Types

```typescript
type DetectedIssue = {
  issueType: string;           // e.g. IssueType.MISSING_IDEMPOTENCY
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidence: number;          // 0.0–1.0
  sourceRef: string;           // e.g. "PR#47" | "commit:abc123" | "file:checkout.ts:47"
  evidence: string[];          // lines of code or context that triggered this
  domain: string;              // which domain pack detected this
  repoOwner: string;
  repoName: string;
};

type PatternRule = {
  id: string;                  // unique within domain
  issueType: string;
  description: string;
  searchQuery: string;         // GitHub Search API query string
  filePathPattern?: string;    // regex to filter matched file paths
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidenceScore: number;     // base confidence when pattern matches
};

type ScanResult = {
  scanner: string;
  issues: DetectedIssue[];
  etag?: string;               // saved back to watcher_state for next tick
};
```

## Watcher Daemon Logic

```
watcherTick(repo, domain):
  1. Load watcher state from SQLite (ETags per scanner)
  2. Run all five scanners in parallel (Promise.all)
  3. Save updated ETags back to SQLite
  4. Filter out issues where a session already exists with same issueType + sourceRef
  5. For each new issue: call agent.startSession(issue)
  6. Log tick summary: "Tick complete. Found N issues, M new sessions started"
  7. Schedule next tick after interval
```

## ETag Strategy

Every scanner stores its last ETag per repo in `watcher_state`. On the next tick:

```typescript
const response = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
  owner, repo,
  headers: { 'If-None-Match': lastEtag ?? '' }
});
// If 304 Not Modified: skip processing, costs 0 rate limit tokens
// If 200: process response, save new ETag
```

## Rate Limit Handling

```typescript
try {
  // scanner request
} catch (err) {
  if (err.status === 403 || err.status === 429) {
    const retryAfter = err.response?.headers['retry-after'] ?? 60;
    log('WARN', `Rate limited. Backing off ${retryAfter}s`, sessionId);
    await sleep(retryAfter * 1000);
    // retry once, then skip this scanner for this tick
  }
}
```

## Deduplication Logic

Before starting a new agent session, check:

```sql
SELECT COUNT(*) FROM agent_sessions
WHERE repo_owner = ? AND repo_name = ?
AND issue_type = ? AND source_ref = ?
AND stage NOT IN ('merged', 'skipped', 'closed')
```

If count > 0, skip — a session for this exact issue is already active.

## Success Criteria

- `vigilant start --repo org/repo` runs, logs tick output every 60 seconds
- New PRs touching payment files trigger a `DetectedIssue` in the logs
- Already-tracked issues are not re-created
- 304 Not Modified responses are logged as "no change" without processing
- Rate limit errors cause backoff then resume, not crash
