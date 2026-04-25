// src/agent/types.ts
// Core domain types shared across all phases.
// Expanded with investigation and plan fields in Phase 3.

export type IssueStage =
  | 'discovered'
  | 'investigating'
  | 'planning'
  | 'awaiting_self_review'
  | 'self_reviewing'
  | 'awaiting_approval'
  | 'executing'
  | 'pr_created'
  | 'awaiting_merge'
  | 'merged'
  | 'skipped'
  | 'closed'
  | 'blocked';

export type IssueSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type CIStatus = 'pending' | 'running' | 'passed' | 'failed' | null;

export type ExecutorStep = 'branch_created' | 'files_written' | 'pr_created' | null;

/** Live state of one issue investigation session. Persisted to state.db. */
export type IssueSession = {
  sessionId:        string;
  repoOwner:        string;
  repoName:         string;
  domain:           string;
  issueType:        string;
  stage:            IssueStage;
  severity:         IssueSeverity;
  confidence:       number;
  sourceRef:        string;
  evidence:         string[];
  iterationCount:   number;
  goalProgress:     number;
  keyFindings:      string[];
  dataCollected:    Record<string, unknown>;
  plan:             Plan | null;
  branchName:       string | null;
  prNumber:         number | null;
  prUrl:            string | null;
  prHeadSha:        string | null;
  ciStatus:         CIStatus;
  executorStep:     ExecutorStep;
  selfReviewCount:  number;
  blockerReason:    string | null;
  stallCount:       number;
  runNumber:        number;
  createdAt:        string;
  updatedAt:        string;
};

// ── Plan types (Phase 3) ──────────────────────────────────────────────────────

/** A single file change produced by the agent's plan generator. */
export type FileChange = {
  /** Repo-relative file path, e.g. "src/checkout/payment.ts" */
  path:         string;
  description:  string;
  /** Exact code being replaced — empty string for purely additive changes */
  before:       string;
  /** Exact replacement code */
  after:        string;
  lineHint?:    number;
  isNewFile?:   boolean;
};

/** The structured fix plan produced after investigation. Shown at Gate 1. */
export type Plan = {
  summary:          string;
  severity:         IssueSeverity;
  confidence:       number;
  rootCause:        string;
  changes:          FileChange[];
  branchName:       string;
  prTitle:          string;
  prBodyMarkdown:   string;
  testSuggestions:  string[];
};

/** A pattern or issue detected by a watcher scanner. */
export type DetectedIssue = {
  repoOwner:   string;
  repoName:    string;
  domain:      string;
  issueType:   string;
  severity:    IssueSeverity;
  confidence:  number;
  sourceRef:   string;
  evidence:    string[];
  description: string;
  /** ISO timestamp when the scanner detected this issue */
  detectedAt:  string;
};
