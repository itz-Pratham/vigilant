# Phase 2 — Types

**File:** `src/watcher/types.ts`

## All Watcher Types

```typescript
import type { Severity } from '@/agent/types';

/**
 * A single issue detected by any scanner during a watcher tick.
 * This is what gets handed to the agent to start an investigation session.
 */
export type DetectedIssue = {
  /** The issue type identifier from the active domain pack, e.g. MISSING_IDEMPOTENCY */
  issueType: string;
  /** How severe this issue is, based on the matching PatternRule */
  severity: Severity;
  /** 0.0–1.0. The base confidence from the PatternRule, possibly adjusted by scanner context */
  confidence: number;
  /**
   * Where the issue was found. Format depends on scanner:
   * - PR scanner:      "PR#47"
   * - Commit scanner:  "commit:abc1234"
   * - CI scanner:      "run:12345678/job:payment-tests"
   * - Dep scanner:     "package:stripe@12.0.0→13.1.0"
   * - Pattern scanner: "file:checkout/payment.ts:47"
   */
  sourceRef: string;
  /** Lines of code or context that triggered this detection */
  evidence: string[];
  /** Which domain pack produced this issue */
  domain: string;
  repoOwner: string;
  repoName: string;
  /** ISO timestamp when the scanner found this */
  detectedAt: string;
};

/**
 * Result returned by a single scanner after one tick.
 */
export type ScanResult = {
  /** Scanner name, e.g. 'pr-scanner', 'pattern-scanner' */
  scanner: string;
  /** Issues found in this scan. Empty array if none. */
  issues: DetectedIssue[];
  /** New ETag value from GitHub response headers, if any. Saved to watcher_state. */
  newEtag?: string;
  /** If true, GitHub returned 304 — nothing changed, no issues, no rate limit cost */
  notModified?: boolean;
};

/**
 * A pattern rule from a domain pack. Defines what to search for and how to score it.
 */
export type PatternRule = {
  /** Unique ID within the domain, e.g. "payments-001" */
  id: string;
  /** The IssueType this rule detects */
  issueType: string;
  /** Human-readable description of what this rule finds */
  description: string;
  /**
   * GitHub Search API query string for the pattern-scanner.
   * Example: 'language:typescript "createPayment" NOT "idempotencyKey"'
   */
  searchQuery: string;
  /**
   * Optional regex to filter matched file paths. Only files matching this
   * regex are reported. Example: /(checkout|payment|order)\.(ts|js)$/
   */
  filePathPattern?: string;
  severity: Severity;
  /** Base confidence when this pattern matches. May be adjusted upward if
   *  corroborating evidence exists (e.g. the file also has no test for idempotency) */
  confidenceScore: number;
  /**
   * Keywords that should appear in CI job names for the CI scanner to flag.
   * Example: ['payment', 'checkout', 'billing']
   */
  ciJobKeywords?: string[];
  /**
   * File path patterns (glob-style) for the PR and commit scanners.
   * Example: ['checkout/**', 'payment/**', '**/webhook*']
   */
  watchedFilePaths?: string[];
};

/**
 * A finding read from an external tool's PR review comment.
 * Tool Observer reads these from PR comment threads and passes them to the agent.
 */
export type ExternalToolFinding = {
  /** Which tool posted this finding */
  tool: 'snyk' | 'coderabbit' | 'dependabot' | 'github_security';
  /** The raw comment text from the bot */
  comment: string;
  /** Severity string from the tool comment, if parseable */
  severity?: string;
  /** File path the finding refers to, if present */
  file?: string;
  /** Line number the finding refers to, if present */
  line?: number;
  /** The PR number this finding came from */
  prNumber: number;
};

/**
 * Result of running the Tool Observer on a set of open PRs.
 */
export type ToolObserverResult = {
  prNumber: number;
  findings: ExternalToolFinding[];
  /** true if at least one known tool bot commented on this PR */
  toolsPresent: boolean;
};

/**
 * Summary of a full watcher tick. Logged after every tick.
 */
export type WatcherTickSummary = {
  repo: string;
  domain: string;
  tickStartedAt: string;
  tickCompletedAt: string;
  scanResults: ScanResult[];
  totalIssuesFound: number;
  newSessionsStarted: number;
  deduplicatedIssues: number;
  notModifiedResponses: number;
  toolObserverResults: ToolObserverResult[];
};

/**
 * State stored in SQLite for each scanner, per repo.
 * Used to send ETag conditional requests on the next tick.
 */
export type WatcherState = {
  repoOwner: string;
  repoName: string;
  scannerName: string;
  lastEtag: string | null;
  lastCheckedAt: string;
};
```
