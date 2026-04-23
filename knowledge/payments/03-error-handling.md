# Payment Error Handling Patterns

## Why it matters
Silent error swallowing on payment calls leads to inconsistent state: the payment may have succeeded server-side while the client shows failure (or vice versa). Both outcomes cause real financial harm.

## How to implement

```typescript
// Typed payment result — never throw from payment code
type PaymentResult =
  | { success: true; chargeId: string; amount: number }
  | { success: false; code: string; message: string; retryable: boolean };

async function createCharge(params: ChargeParams): Promise<PaymentResult> {
  try {
    const charge = await stripe.charges.create({ ...params, idempotencyKey: params.idempotencyKey });
    return { success: true, chargeId: charge.id, amount: charge.amount };
  } catch (err) {
    if (err instanceof Stripe.errors.StripeCardError) {
      return { success: false, code: err.code ?? 'card_error', message: err.message, retryable: false };
    }
    if (err instanceof Stripe.errors.StripeRateLimitError) {
      return { success: false, code: 'rate_limit', message: err.message, retryable: true };
    }
    // Unknown error — log with full context, do not swallow
    logger.error('Unexpected payment error', { err, params: { ...params, idempotencyKey: '[REDACTED]' } });
    return { success: false, code: 'unknown', message: 'Unexpected error', retryable: false };
  }
}
```

## Key implementation details
- Classify errors as terminal vs retryable before any retry logic
- Terminal errors (INSUFFICIENT_FUNDS, CARD_DECLINED, EXPIRED_CARD): never retry, show user
- Transient errors (NETWORK_ERROR, RATE_LIMIT): retry with exponential backoff
- Never log card numbers, CVVs, or full PANs — even in error logs
- Every catch block must either rethrow or return a typed failure — never `catch(e) {}`

## References
- https://stripe.com/docs/error-codes
- https://stripe.com/docs/api/errors/handling
