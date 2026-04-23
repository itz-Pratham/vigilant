# Phase 1 — Types

**File:** `src/config/types.ts`, `src/lib/errors.ts`, `src/lib/constants.ts`

## Objective

Define every TypeScript type needed in Phase 1: the config shape, error hierarchy, log levels, and CLI option types. These types are the contract that all other phases depend on.

---

## Config Types (`src/config/types.ts`)

```typescript
/**
 * The full configuration for a vigilant installation.
 * Stored at ~/.vigilant/config.json with mode 0o600.
 */
export type VigilantConfig = {
  /** GitHub Personal Access Token with repo + workflow scopes */
  githubToken: string;

  /** Google Gemini API key — primary AI provider (free tier available) */
  geminiApiKey?: string;

  /** Groq API key — fallback AI provider (free tier available) */
  groqApiKey?: string;

  /** OpenAI API key — optional additional fallback */
  openaiApiKey?: string;

  /** Ollama base URL — for fully local inference, e.g. "http://localhost:11434" */
  ollamaBaseUrl?: string;

  /**
   * Repos to watch on `vigilant start` with no --repo flag.
   * Format: ["owner/repo", "owner/repo2"]
   */
  defaultRepos: string[];

  /**
   * How often the watcher tick runs, in seconds.
   * Default: 60. Minimum enforced: 30 (to avoid rate limit spikes).
   */
  watchIntervalSeconds: number;

  /**
   * Active domain packs. At least one required.
   * Valid values: "payments" | "security" | "reliability" | "compliance"
   */
  domains: string[];

  /**
   * Maximum agentic loop iterations per session before marking blocked.
   * Default: 20
   */
  maxIterations: number;

  /**
   * If true, automatically merge PRs when CI passes without showing Gate 2.
   * Default: false — always show Gate 2.
   */
  autoMerge: boolean;
};

/**
 * The raw JSON shape on disk. Same as VigilantConfig but every field
 * optional so we can load partial configs and validate separately.
 */
export type RawConfig = Partial<VigilantConfig>;

/**
 * Result of config validation. On error, includes a human-readable message.
 */
export type ConfigValidationResult =
  | { valid: true; config: VigilantConfig }
  | { valid: false; error: string };
```

---

## Error Types (`src/lib/errors.ts`)

```typescript
/**
 * Base error class for all vigilant errors.
 * All errors include a machine-readable code for programmatic handling.
 */
export class VigilantError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'VigilantError';
  }
}

/**
 * Thrown when GitHub API returns an unexpected status or rate limit error.
 */
export class GitHubAPIError extends VigilantError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'GITHUB_API_ERROR', { status, endpoint, ...context });
    this.name = 'GitHubAPIError';
  }
}

/**
 * Thrown when GitHub returns 403 or 429 (rate limited).
 * Caller should back off exponentially.
 */
export class GitHubRateLimitError extends GitHubAPIError {
  constructor(
    public readonly retryAfterSeconds: number,
    endpoint: string
  ) {
    super(
      `GitHub rate limited on ${endpoint}. Retry after ${retryAfterSeconds}s`,
      429,
      endpoint,
      { retryAfterSeconds }
    );
    this.name = 'GitHubRateLimitError';
  }
}

/**
 * Thrown when the AI provider returns an error or rate limits.
 * NeuroLink should handle failover internally — this is only thrown
 * when ALL configured providers fail.
 */
export class AIProviderError extends VigilantError {
  constructor(message: string, public readonly provider: string) {
    super(message, 'AI_PROVIDER_ERROR', { provider });
    this.name = 'AIProviderError';
  }
}

/**
 * Thrown when config.json is missing, corrupt, or fails validation.
 */
export class ConfigError extends VigilantError {
  constructor(message: string, public readonly field?: string) {
    super(message, 'CONFIG_ERROR', { field });
    this.name = 'ConfigError';
  }
}

/**
 * Thrown when a DB operation fails (SQLite error).
 */
export class DatabaseError extends VigilantError {
  constructor(message: string, public readonly query?: string) {
    super(message, 'DATABASE_ERROR', { query });
    this.name = 'DatabaseError';
  }
}

/**
 * Thrown when the executor fails during a specific step.
 * Includes the step name so crash recovery knows where to resume.
 */
export class ExecutorError extends VigilantError {
  constructor(
    message: string,
    public readonly step: 'branch' | 'write_file' | 'pr' | 'ci_monitor',
    public readonly sessionId: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'EXECUTOR_ERROR', { step, sessionId, ...context });
    this.name = 'ExecutorError';
  }
}
```

---

## Log Level Types (`src/lib/logger.ts` types section)

```typescript
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export type LogEntry = {
  timestamp: string;    // ISO 8601
  level: LogLevel;
  context: string;      // session ID or 'daemon' or 'watcher' or 'learner'
  message: string;
  data?: Record<string, unknown>;
};
```

---

## CLI Option Types (`src/cli/types.ts`)

```typescript
export type StartOptions = {
  repo: string;
  domain?: string;
  interval?: string;   // parsed to number, string from Commander
};

export type ServeOptions = {
  port?: string;
  host?: string;
};

export type LearnOptions = {
  topic: string;
  domain?: string;
  repo?: string;
};

export type ConfigSetOptions = {
  key: string;
  value: string;
};
```
