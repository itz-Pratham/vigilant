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
 * Conditional GET using ETag for cache efficiency.
 * Returns null if GitHub says 304 Not Modified — caller should skip processing.
 */
export async function conditionalGet<T>(params: {
  octokitFn: (headers: Record<string, string>) => Promise<{ data: T; headers: Record<string, string> }>;
  lastEtag: string | null;
  context?: string;
}): Promise<{ data: T; etag: string } | null> {
  const headers: Record<string, string> = {};
  if (params.lastEtag) headers['If-None-Match'] = params.lastEtag;

  try {
    const response = await params.octokitFn(headers);
    const newEtag  = (response.headers['etag'] as string) ?? '';
    return { data: response.data, etag: newEtag };
  } catch (err: unknown) {
    if (
      typeof err === 'object' && err !== null && 'status' in err &&
      (err as { status: number }).status === 304
    ) {
      return null;
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
