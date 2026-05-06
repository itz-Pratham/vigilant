// src/executor/code-writer.ts
// Applies approved plan changes to the branch via exact before→after replacement.
// Does NOT use AI to regenerate files — the human approved the exact diff at Gate 1.
// Sequential writes are required: concurrent writes on the same branch cause SHA conflicts.

import { githubRequest } from '../lib/github.js';
import { info, warn }    from '../lib/logger.js';
import type { IssueSession, FileChange } from '../agent/types.js';
import type { ExecutorContext, FileWriteResult } from './types.js';

/**
 * Applies all file changes in `session.plan.changes` sequentially.
 * Returns results for each file — caller decides how to handle failures.
 */
export async function writeAllChanges(
  session: IssueSession,
  ctx:     ExecutorContext,
): Promise<FileWriteResult[]> {
  const results: FileWriteResult[] = [];

  for (const change of session.plan!.changes) {
    const result = await writeFileChange(session, ctx, change);
    results.push(result);
    if (!result.success) {
      warn(`File write failed for ${change.path}: ${result.error}`, 'executor');
    } else {
      info(`Wrote ${change.path} (commit: ${result.commitSha.slice(0, 7)})`, 'executor');
    }
  }

  return results;
}

async function writeFileChange(
  session: IssueSession,
  ctx:     ExecutorContext,
  change:  FileChange,
): Promise<FileWriteResult> {
  // 1. Read existing file (if it exists) to get current content + SHA
  let originalContent = '';
  let fileSha: string | undefined;

  try {
    const data = await githubRequest(
      (octokit) => octokit.repos.getContent({
        owner: ctx.owner,
        repo:  ctx.repo,
        path:  change.path,
        ref:   ctx.branchName,
      }).then(r => r.data),
      'executor',
    );

    if (Array.isArray(data) || (data as { type?: string }).type !== 'file') {
      return { path: change.path, commitSha: '', success: false, error: 'Path is a directory, not a file' };
    }

    const fileData = data as { content?: string; sha: string };
    originalContent = Buffer.from(fileData.content ?? '', 'base64').toString('utf-8');
    fileSha         = fileData.sha;
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status !== 404) {
      return {
        path:      change.path,
        commitSha: '',
        success:   false,
        error:     `Read failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    // 404 = new file — originalContent stays ''
  }

  // 2. Compute new content via exact string replacement
  let newContent: string;

  if (!change.before) {
    // Empty before = write entire file as-is (handles new files and full rewrites)
    newContent = change.after;
  } else if (!originalContent.includes(change.before)) {
    return {
      path:      change.path,
      commitSha: '',
      success:   false,
      error:     `Cannot apply change: 'before' snippet not found in ${change.path}`,
    };
  } else {
    // Replace the first occurrence of before with after
    newContent = originalContent.replace(change.before, change.after);
  }

  // 3. Encode and write back to GitHub
  const encodedContent = Buffer.from(newContent).toString('base64');
  const commitMessage  = `fix(${session.domain}): ${change.description} [vigilant]\n\nSession: ${session.sessionId}`;

  try {
    const commitData = await githubRequest(
      (octokit) => octokit.repos.createOrUpdateFileContents({
        owner:   ctx.owner,
        repo:    ctx.repo,
        path:    change.path,
        message: commitMessage,
        content: encodedContent,
        branch:  ctx.branchName,
        ...(fileSha !== undefined ? { sha: fileSha } : {}),
      }).then(r => r.data),
      'executor',
    );

    const sha = (commitData.commit as { sha?: string }).sha ?? '';
    return { path: change.path, commitSha: sha, success: true };
  } catch (err: unknown) {
    return {
      path:      change.path,
      commitSha: '',
      success:   false,
      error:     `Write failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
