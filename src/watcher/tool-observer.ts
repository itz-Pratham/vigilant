// src/watcher/tool-observer.ts
// Reads PR review comments from known tool bots (Snyk, CodeRabbit, Dependabot, GitHub Security).

import { githubRequest } from '../lib/github.js';
import { debug, warn } from '../lib/logger.js';
import { TOOL_BOT_USERNAMES } from '../lib/constants.js';
import type { ExternalToolFinding, ToolObserverResult } from './types.js';

type ReviewComment = {
  id:   number;
  body: string;
  user: { login: string } | null;
  path?: string;
  line?: number | null;
};

type IssueComment = {
  id:   number;
  body: string;
  user: { login: string } | null;
};

/**
 * Observe a single open PR for comments from known tool bots.
 * Returns findings from Snyk, CodeRabbit, Dependabot, and GitHub Security.
 */
export async function observePR(params: {
  owner:    string;
  repo:     string;
  prNumber: number;
}): Promise<ToolObserverResult> {
  const { owner, repo, prNumber } = params;
  const context = `tool-observer:pr-${prNumber}`;
  const findings: ExternalToolFinding[] = [];

  // Fetch both review comments (inline) and issue comments (general PR comments)
  const [reviewComments, issueComments] = await Promise.allSettled([
    githubRequest(
      (octokit) =>
        octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/comments', {
          owner,
          repo,
          pull_number: prNumber,
          per_page:    100,
        }).then(r => r.data),
      context,
    ) as Promise<ReviewComment[]>,
    githubRequest(
      (octokit) =>
        octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
          owner,
          repo,
          issue_number: prNumber,
          per_page:     100,
        }).then(r => r.data),
      context,
    ) as Promise<IssueComment[]>,
  ]);

  const allComments: Array<{ body: string; login: string; path?: string; line?: number | null }> = [];

  if (reviewComments.status === 'fulfilled') {
    for (const c of reviewComments.value) {
      if (c.user) allComments.push({ body: c.body, login: c.user.login, path: c.path, line: c.line });
    }
  } else {
    warn(`Could not fetch review comments for PR #${prNumber}`, context, reviewComments.reason);
  }

  if (issueComments.status === 'fulfilled') {
    for (const c of issueComments.value) {
      if (c.user) allComments.push({ body: c.body, login: c.user.login });
    }
  } else {
    warn(`Could not fetch issue comments for PR #${prNumber}`, context, issueComments.reason);
  }

  let toolsPresent = false;

  for (const comment of allComments) {
    const tool = TOOL_BOT_USERNAMES[comment.login];
    if (!tool) continue;

    toolsPresent = true;
    debug(`Found ${tool} comment on PR #${prNumber}`, context);

    // Extract severity hint from comment text (best-effort)
    let severity: string | undefined;
    const bodyLower = comment.body.toLowerCase();
    if (bodyLower.includes('critical'))      severity = 'CRITICAL';
    else if (bodyLower.includes('high'))     severity = 'HIGH';
    else if (bodyLower.includes('medium'))   severity = 'MEDIUM';
    else if (bodyLower.includes('low'))      severity = 'LOW';

    findings.push({
      tool,
      comment:  comment.body.slice(0, 2000), // cap comment length
      severity,
      file:     comment.path,
      line:     comment.line ?? undefined,
      prNumber,
    });
  }

  return { prNumber, findings, toolsPresent };
}

/**
 * Observe all open PRs in parallel for tool bot findings.
 * Returns the list of PRs that had at least one tool comment.
 */
export async function observeAllOpenPRs(params: {
  owner:    string;
  repo:     string;
  prNumbers: number[];
}): Promise<ToolObserverResult[]> {
  const results = await Promise.allSettled(
    params.prNumbers.map(n => observePR({ owner: params.owner, repo: params.repo, prNumber: n })),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<ToolObserverResult> => r.status === 'fulfilled')
    .map(r => r.value);
}
