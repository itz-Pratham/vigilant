# Phase 1 — Errors

**File:** `src/lib/errors.ts`

## Objective

A typed error hierarchy so every `catch` block in the codebase knows exactly what failed and why. All vigilant errors extend `VigilantError`. Callers import the specific subclass they need — no string-matching on `message`.

---

## Implementation

```typescript
// src/lib/errors.ts

/** Base class for all vigilant errors. Never thrown directly — use a subclass. */
export class VigilantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VigilantError';
  }
}

/** Config file missing, invalid JSON, or failed validation. Exits with code 1. */
export class ConfigError extends VigilantError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** GitHub API returned an unexpected non-2xx status. */
export class GitHubAPIError extends VigilantError {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly endpoint: string,
  ) {
    super(message);
    this.name = 'GitHubAPIError';
  }
}

/** GitHub returned 403 or 429 — rate limited. Contains retry delay. */
export class GitHubRateLimitError extends GitHubAPIError {
  constructor(
    public readonly retryAfterSeconds: number,
    endpoint: string,
  ) {
    super(`GitHub rate limited on ${endpoint}. Retry after ${retryAfterSeconds}s`, 429, endpoint);
    this.name = 'GitHubRateLimitError';
  }
}

/** AI provider (Gemini / Groq / OpenAI) returned an error after all retries. */
export class AIProviderError extends VigilantError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly provider?: string,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

/** SQLite operation failed. Treated as fatal — DB corruption is unrecoverable. */
export class DatabaseError extends VigilantError {
  constructor(message: string, public readonly operation: string) {
    super(message);
    this.name = 'DatabaseError';
  }
}

/** Executor step failed (branch create, file write, PR create, CI poll). */
export class ExecutorError extends VigilantError {
  constructor(
    message: string,
    /** Which step failed: 'branch' | 'write' | 'pr' | 'ci' */
    public readonly step: string,
    public readonly sessionId: string,
  ) {
    super(message);
    this.name = 'ExecutorError';
  }
}
```

---

## How Each Error Is Handled

| Error class | Handler | Outcome |
|---|---|---|
| `ConfigError` | `src/cli/commands/*.ts` top-level catch | Print to stderr, `process.exit(1)` |
| `GitHubRateLimitError` | `githubRequest()` wrapper | Exponential backoff, transparent retry |
| `GitHubAPIError` | Watcher tick catch | Log ERROR, skip this scanner for the tick |
| `AIProviderError` | Agent loop catch | `markBlocked(session, 'AI_PROVIDER_ERROR: …')` |
| `DatabaseError` | Daemon top-level catch | Log ERROR, `process.exit(1)` |
| `ExecutorError` | Executor orchestrator | `markBlocked(session, 'EXECUTOR_FAILED: …')` |
