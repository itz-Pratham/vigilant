// src/executor/types.ts
// Shared types used across all executor sub-components.

/** Contextual identifiers needed by every executor step. */
export type ExecutorContext = {
  owner:         string;
  repo:          string;
  branchName:    string;
  baseSha:       string;
  defaultBranch: string;
};

/** Result of writing a single file change to GitHub. */
export type FileWriteResult = {
  path:      string;
  commitSha: string;
  success:   boolean;
  error?:    string;
};

/**
 * Snapshot of CI check-run status for a PR head SHA.
 * 'pending' = no check runs yet;  'running' = in progress;
 * 'success' = all passed;         'failure' = at least one failed.
 */
export type CICheckResult = {
  status:     'pending' | 'running' | 'success' | 'failure';
  failedJob?: string;
};
