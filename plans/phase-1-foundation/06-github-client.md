# Phase 1 — GitHub Client

**File:** `src/lib/github.ts`

## Objective

A singleton GitHub API client using `@octokit/rest`. All GitHub API calls in the entire project go through functions exported from this file. Rate limit handling (ETag, backoff) is centralised here. No other file calls Octokit directly.

---

## Implementation

```typescript
import { Octokit } from '@octokit/rest';
import { loadConfig } from '@/config/index';
import { GitHubRateLimitError, GitHubAPIError } from '@/lib/errors';
import { warn, info } from '@/lib/logger';

let _octokit: Octokit | null = null;

/** Get the authenticated Octokit instance (lazy, singleton). */
export function getGitHub(): Octokit {
  if (_octokit) return _octokit;
  const config = loadConfig();
  _octokit = new Octokit({ auth: config.githubToken });
  return _octokit;
}

/**
 * Wrapper for any GitHub API call with rate limit handling.
 * Retries once after backing off if rate limited.
 */
export async function githubRequest<T>(
  fn: (octokit: Octokit) => Promise<T>,
  context: string = 'daemon'
): Promise<T> {
  const octokit = getGitHub();
  try {
    return await fn(octokit);
  } catch (err: unknown) {
    if (isRateLimitError(err)) {
      const retryAfter = extractRetryAfter(err);
      warn(`Rate limited. Backing off ${retryAfter}s`, context);
      await sleep(retryAfter * 1000);
      return await fn(octokit);   // retry once
    }
    if (isOctokitError(err)) {
      throw new GitHubAPIError(
        (err as { message: string }).message,
        (err as { status: number }).status,
        'unknown',
        { originalError: (err as Error).message }
      );
    }
    throw err;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function isRateLimitError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null &&
    'status' in err &&
    ((err as { status: number }).status === 403 ||
     (err as { status: number }).status === 429)
  );
}

function isOctokitError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'status' in err;
}

function extractRetryAfter(err: unknown): number {
  if (typeof err === 'object' && err !== null && 'response' in err) {
    const response = (err as { response?: { headers?: Record<string, string> } }).response;
    const header = response?.headers?.['retry-after'];
    if (header) return parseInt(header, 10);
  }
  return 60;  // default: back off 60s
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## ETag Utilities

```typescript
/**
 * Make a conditional GET request using ETag.
 * If GitHub returns 304 (Not Modified), returns null — caller should skip processing.
 * If GitHub returns 200, returns { data, etag } — caller processes and saves new ETag.
 */
export async function conditionalGet<T>(params: {
  endpoint: string;
  octokitFn: (headers: Record<string, string>) => Promise<{ data: T; headers: Record<string, string> }>;
  lastEtag: string | null;
  context?: string;
}): Promise<{ data: T; etag: string } | null> {
  const headers: Record<string, string> = {};
  if (params.lastEtag) headers['If-None-Match'] = params.lastEtag;

  try {
    const response = await params.octokitFn(headers);
    const newEtag = response.headers['etag'] ?? '';
    return { data: response.data, etag: newEtag };
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'status' in err &&
        (err as { status: number }).status === 304) {
      // Not modified — no rate limit cost
      return null;
    }
    throw err;
  }
}
```
