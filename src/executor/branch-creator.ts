// src/executor/branch-creator.ts
// Creates a new GitHub branch from the default branch HEAD.
// Treats 422 (already exists) as success for crash-recovery.

import { githubRequest } from '../lib/github.js';
import { info }          from '../lib/logger.js';
import { ExecutorError } from '../lib/errors.js';
import type { ExecutorContext } from './types.js';

/**
 * Resolves the repo's default branch name and its current HEAD SHA.
 * Used to determine where to branch from.
 */
export async function resolveBaseSha(
  owner: string,
  repo:  string,
): Promise<{ defaultBranch: string; sha: string }> {
  const repoData = await githubRequest(
    (octokit) => octokit.repos.get({ owner, repo }).then(r => r.data),
    'executor',
  );

  const defaultBranch = repoData.default_branch;

  const refData = await githubRequest(
    (octokit) => octokit.git.getRef({
      owner, repo,
      ref: `heads/${defaultBranch}`,
    }).then(r => r.data),
    'executor',
  );

  return { defaultBranch, sha: refData.object.sha };
}

/**
 * Creates a branch on GitHub from `ctx.baseSha`.
 * If the branch already exists (422), treats it as success (crash recovery).
 * Throws `ExecutorError` with step='branch' on any other failure.
 */
export async function createBranch(ctx: ExecutorContext, sessionId: string): Promise<void> {
  try {
    await githubRequest(
      (octokit) => octokit.git.createRef({
        owner: ctx.owner,
        repo:  ctx.repo,
        ref:   `refs/heads/${ctx.branchName}`,
        sha:   ctx.baseSha,
      }).then(r => r.data),
      'executor',
    );
    info(`Branch ${ctx.branchName} created`, 'executor');
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 422) {
      // Branch already exists from a previous crashed run — safe to continue
      info(`Branch ${ctx.branchName} already exists — continuing (crash recovery)`, 'executor');
      return;
    }
    throw new ExecutorError(
      `Branch creation failed: ${err instanceof Error ? err.message : String(err)}`,
      'branch',
      sessionId,
    );
  }
}
