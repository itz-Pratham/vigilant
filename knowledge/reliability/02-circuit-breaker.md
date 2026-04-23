# Circuit Breaker Pattern

## Why it matters
When an external service is degraded, calls to it still take the full timeout duration before failing. Under load, all threads pile up waiting for the timeout. A circuit breaker trips open after a failure threshold and immediately rejects calls until the service recovers.

## How to implement

```typescript
import CircuitBreaker from 'opossum';

async function callPaymentAPI(params: unknown): Promise<unknown> {
  const response = await httpClient.post('/charges', params);
  return response.data;
}

const breaker = new CircuitBreaker(callPaymentAPI, {
  timeout:            5000,    // call fails after 5s
  errorThresholdPercentage: 50, // open if >50% of calls fail
  resetTimeout:       30_000,  // try half-open after 30s
  volumeThreshold:    5,        // need at least 5 calls before tripping
});

breaker.fallback(() => ({ error: 'Payment service unavailable', retryable: true }));

breaker.on('open',     () => logger.warn('Circuit breaker opened — payment API degraded'));
breaker.on('halfOpen', () => logger.info('Circuit breaker half-open — testing payment API'));
breaker.on('close',    () => logger.info('Circuit breaker closed — payment API recovered'));

// Usage
const result = await breaker.fire(chargeParams);
```

## Key implementation details
- Always set a fallback — callers should never see `CircuitBreakerOpenError` as an unhandled exception
- `volumeThreshold` prevents tripping on startup noise (first 5 calls)
- Log state transitions for observability — circuit state is a key operational signal
- One circuit breaker per downstream dependency, not one shared breaker

## References
- https://github.com/nodeshift/opossum
- https://martinfowler.com/bliki/CircuitBreaker.html
