# Retry Logic for Transient Failures

## Why it matters
Network calls to external services fail transiently (connection resets, rate limits, brief outages). Without retry logic, these transient failures surface as errors to users. Without smart retry logic, retrying terminal errors wastes resources and worsens outages.

## How to implement

```typescript
import retry from 'p-retry';

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

async function callWithRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  return retry(
    async (attemptNumber) => {
      try {
        return await fn();
      } catch (err) {
        const status = (err as { response?: { status?: number } }).response?.status;
        if (status && !RETRYABLE_STATUS_CODES.has(status)) {
          throw new retry.AbortError(`Non-retryable status ${status}`);
        }
        logger.warn(`${label} attempt ${attemptNumber} failed`, { err });
        throw err;
      }
    },
    {
      retries:    3,
      factor:     2,
      minTimeout: 500,
      maxTimeout: 5000,
      randomize:  true,  // jitter prevents thundering herd
    }
  );
}
```

## Key implementation details
- Use `AbortError` to immediately stop retrying terminal errors (4xx except 429)
- Add jitter (`randomize: true`) to prevent thundering herd after outages
- Log each failed attempt with attempt number — essential for debugging
- Never retry mutations without idempotency keys — retrying a non-idempotent write creates duplicates

## References
- https://github.com/sindresorhus/p-retry
- https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
