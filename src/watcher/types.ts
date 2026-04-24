// src/watcher/types.ts

import type { IssueSeverity, DetectedIssue } from '../agent/types.js';

export type { DetectedIssue };

/**
 * A pattern rule from a domain pack — defines what to search for and how to score it.
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
   * Optional regex to filter matched file paths.
   * Example: "(checkout|payment|order)\.(ts|js)$"
   */
  filePathPattern?: string;
  severity: IssueSeverity;
  /** Base confidence score 0.0–1.0 when this pattern matches */
  confidenceScore: number;
  /**
   * Keywords that should appear in CI job names for the CI scanner.
   * Example: ['payment', 'checkout', 'billing']
   */
  ciJobKeywords?: string[];
  /**
   * File path glob patterns for PR and commit scanners.
   * Example: checkout/**  payment/**  ** /webhook*
   */
  watchedFilePaths?: string[];
};

/**
 * Result returned by a single scanner after one tick.
 */
export type ScanResult = {
  scanner:      string;
  issues:       DetectedIssue[];
  /** New ETag from GitHub response headers — saved to watcher_state */
  newEtag?:     string;
  /** True when GitHub returned 304 — no change, zero rate-limit cost */
  notModified?: boolean;
};

/**
 * A finding read from an external tool's PR review comment.
 */
export type ExternalToolFinding = {
  tool:      'snyk' | 'coderabbit' | 'dependabot' | 'github_security';
  comment:   string;
  severity?: string;
  file?:     string;
  line?:     number;
  prNumber:  number;
};

/**
 * Result of running the Tool Observer on one open PR.
 */
export type ToolObserverResult = {
  prNumber:     number;
  findings:     ExternalToolFinding[];
  /** True if at least one known tool bot commented on this PR */
  toolsPresent: boolean;
};

/**
 * Summary logged after every watcher tick.
 */
export type WatcherTickSummary = {
  repo:                  string;
  domain:                string;
  tickStartedAt:         string;
  tickCompletedAt:       string;
  scanResults:           ScanResult[];
  totalIssuesFound:      number;
  newSessionsStarted:    number;
  deduplicatedIssues:    number;
  notModifiedResponses:  number;
  toolObserverResults:   ToolObserverResult[];
};
