# Phase 3 — Error Handling

**File:** `src/agent/errors.ts` + error handling inside `loop.ts`

## Objective

Defines how the agent loop recovers from transient failures (rate limits, network errors) vs. permanent failures (bad config, unknown issue type). Transient errors are retried with exponential backoff; permanent errors mark the session `blocked` immediately.

---

## Error Classes (Phase 1 defines base; Phase 3 adds agent-specific ones)

```typescript
// Already defined in src/lib/errors.ts (Phase 1):
//   VigilantError, GitHubAPIError, AIProviderError, ConfigError, ExecutorError

// Phase 3 adds:
export class AgentLoopError extends VigilantError {
  constructor(message: string, public readonly sessionId: string) {
    super(message);
    this.name = 'AgentLoopError';
  }
}

export class ToolExecutionError extends VigilantError {
  constructor(message: string, public readonly toolName: string) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}
```

---

## Retry Logic for AI Provider Calls

NeuroLink handles provider failover automatically (Gemini → Groq). The retry wrapper below handles rate-limit 429s and transient 5xx that NeuroLink does not absorb.

```typescript
// src/agent/loop.ts

const MAX_AI_RETRIES    = 3;
const RETRY_BASE_MS     = 2000;

async function callWithRetry<T>(fn: () => Promise<T>, sessionId: string): Promise<T> {
  for (let attempt = 0; attempt < MAX_AI_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const isRetryable = err instanceof AIProviderError && err.statusCode !== undefined
        ? [429, 500, 502, 503].includes(err.statusCode)
        : false;

      if (!isRetryable || attempt === MAX_AI_RETRIES - 1) throw err;

      const delay = RETRY_BASE_MS * 2 ** attempt;
      logger.warn(`AI call failed (attempt ${attempt + 1}), retrying in ${delay}ms`, sessionId);
      await sleep(delay);
    }
  }
  throw new AgentLoopError('AI call failed after all retries', sessionId);
}
```

---

## Error Handling in the Loop

```typescript
// src/agent/loop.ts — outer catch block

try {
  await runAgentLoopInner(session, pack, config);
} catch (err: unknown) {
  if (err instanceof GitHubAPIError && err.statusCode === 403) {
    // Rate limited — mark blocked, daemon will retry after backoff
    markBlocked(session, `GITHUB_RATE_LIMITED: retry after ${err.retryAfter ?? 60}s`);
  } else if (err instanceof AIProviderError) {
    markBlocked(session, `AI_PROVIDER_ERROR: ${(err as Error).message}`);
  } else if (err instanceof ToolExecutionError) {
    markBlocked(session, `TOOL_FAILED: ${err.toolName} — ${err.message}`);
  } else {
    // Unknown error — block and log the full stack
    markBlocked(session, `UNEXPECTED_ERROR: ${(err as Error).message}`);
    logger.error(`Unexpected error in agent loop`, session.sessionId, { err });
  }
}
```

---

## Blocker Reason Prefixes

| Prefix | What it means | Auto-retry? |
|---|---|---|
| `STALL:` | Agent made no progress | Yes — on next `vigilant session <id>` retry |
| `MAX_ITERATIONS_REACHED` | Hit hard cap | No — needs human review |
| `GITHUB_RATE_LIMITED:` | 403 from GitHub | Yes — daemon retries after stated delay |
| `AI_PROVIDER_ERROR:` | Both providers failed | Yes — on retry |
| `TOOL_FAILED:` | A tool threw unexpectedly | Yes — on retry |
| `UNEXPECTED_ERROR:` | Unknown — read logs | No — needs human review |
