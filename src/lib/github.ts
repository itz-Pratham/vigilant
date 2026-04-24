// src/lib/github.ts

import { Octokit } from '@octokit/rest';
import { loadConfig } from '../config/index.js';
import { GitHubRateLimitError, GitHubAPIError } from './errors.js';
import { warn } from './logger.js';

let _octokit: Octokit | null = null;

/** Returns the authenticated Octokit singleton. Lazy-initialised on first call. */
export function getGitHub(): Octokit {
  if (_octokit) return _octokit;
  const config = loadConfig();
  _octokit = new Octokit({ auth: config.githubToken });
  return _octokit;
}

/**
 * Wraps any GitHub API call with automatic rate-limit handling.
 * Backs off and retries once if GitHub returns 403 or 429.
 */
export async function githubRequest<T>(
  fn: (octokit: Octokit) => Promise<T>,
  context: string = 'daemon',
): Promise<T> {
  const octokit = getGitHub();
  try {
    return await fn(octokit);
  } catch (err: unknown) {
    if (isRateLimitError(err)) {
      const retryAfter = extractRetryAfter(err);
      warn(`Rate limited. Backing off ${retryAfter}s`, context);
      await sleep(retryAfter * 1000);
      return await fn(octokit);
    }
    if (isOctokitError(err)) {
      throw new GitHubAPIError(
        (err as { message: string }).message,
        (err as { status: number }).status,
        'unknown',
      );
    }
    throw err;
  }
}

/**
 * Conditional GET using ETag. Returns null if GitHub returns 304 Not Modified.
 * Handles rate limits with one automatic retry.
 *
 * @param fn  Function receiving (octokit, extraHeaders) — must return the full Octokit response
 *            (not just data) so we can read the ETag from response.headers.
 */
export async function conditionalGet<T>(params: {
  fn: (
    octokit: Octokit,
    extraHeaders: Record<string, string>,
  ) => Promise<{ data: T; headers: Record<string, string | number | undefined>; status: number }>;
  lastEtag: string | null;
  context?: string;
}): Promise<{ data: T; etag: string } | null> {
  const octokit = getGitHub();
  const extraHeaders: Record<string, string> = {};
  if (params.lastEtag) extraHeaders['If-None-Match'] = params.lastEtag;

  const attempt = async () => params.fn(octokit, extraHeaders);

  try {
    const response = await attempt();
    if (response.status === 304) return null;
    const etag = String(response.headers['etag'] ?? '');
    return { data: response.data, etag };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 304) return null;
    if (isRateLimitError(err)) {
      const retryAfter = extractRetryAfter(err);
      warn(`Rate limited. Backing off ${retryAfter}s`, params.context ?? 'daemon');
      await sleep(retryAfter * 1000);
      try {
        const response = await attempt();
        if (response.status === 304) return null;
        const etag = String(response.headers['etag'] ?? '');
        return { data: response.data, etag };
      } catch (retryErr: unknown) {
        if ((retryErr as { status?: number }).status === 304) return null;
        throw retryErr;
      }
    }
    throw err;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function isRateLimitError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && 'status' in err &&
    ((err as { status: number }).status === 403 || (err as { status: number }).status === 429)
  );
}

function isOctokitError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'status' in err;
}

function extractRetryAfter(err: unknown): number {
  if (typeof err === 'object' && err !== null && 'response' in err) {
    const res    = (err as { response?: { headers?: Record<string, string> } }).response;
    const header = res?.headers?.['retry-after'];
    if (header) return parseInt(header, 10);
  }
  return 60;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
