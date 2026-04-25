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

/** Agentic loop stalled — no goalProgress for STALL_THRESHOLD consecutive iterations. */
export class AgentLoopError extends VigilantError {
  constructor(message: string, public readonly sessionId: string) {
    super(message);
    this.name = 'AgentLoopError';
  }
}

/** A specific tool call failed during agent investigation. */
export class ToolExecutionError extends VigilantError {
  constructor(message: string, public readonly toolName: string) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}

/** Executor step failed (branch create, file write, PR create, CI poll). */
export class ExecutorError extends VigilantError {
  constructor(
    message: string,
    public readonly step: 'branch' | 'write_file' | 'pr' | 'ci_monitor',
    public readonly sessionId: string,
  ) {
    super(message);
    this.name = 'ExecutorError';
  }
}
