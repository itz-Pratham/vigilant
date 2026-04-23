# Safe Retry Patterns for Payment APIs

## Why it matters
Retrying a terminal payment error (insufficient funds, card declined) wastes API calls and confuses users. Not retrying a transient error (network timeout, rate limit) loses genuine payments.

## How to implement

```typescript
import retry from 'p-retry';

const TERMINAL_CODES = new Set([
  'insufficient_funds', 'card_declined', 'do_not_honor',
  'expired_card', 'incorrect_cvc', 'card_velocity_exceeded',
]);

async function chargeWithRetry(params: ChargeParams): Promise<Stripe.Charge> {
  return retry(
    async () => {
      const result = await stripe.charges.create(params, { idempotencyKey: params.idempotencyKey });
      return result;
    },
    {
      retries: 3,
      factor: 2,
      minTimeout: 1000,
      maxTimeout: 8000,
      onFailedAttempt: (err) => {
        if (TERMINAL_CODES.has((err as Stripe.errors.StripeError).code ?? '')) {
          throw new retry.AbortError(err.message);  // stop retrying immediately
        }
        logger.warn('Payment attempt failed, will retry', { attempt: err.attemptNumber });
      },
    }
  );
}
```

## Terminal vs transient reference

| Code | Type | Action |
|---|---|---|
| `insufficient_funds` | Terminal | Never retry, tell user |
| `card_declined` | Terminal | Never retry, tell user |
| `rate_limit` | Transient | Retry after 1s |
| `network_error` | Transient | Retry with backoff |
| `api_connection_error` | Transient | Retry with backoff |

## References
- https://stripe.com/docs/error-codes
- https://github.com/sindresorhus/p-retry
