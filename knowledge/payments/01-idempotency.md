# Idempotency in Payment APIs

## Why it matters
Payment APIs are called over unreliable networks. If a charge creation request times out, the client cannot know if the server processed it. Without idempotency, retrying creates duplicate charges. This is one of the most common production bugs in payment systems.

## How to implement

```typescript
import { v4 as uuidv4 } from 'uuid';

// Stripe SDK
await stripe.charges.create(params, { idempotencyKey: uuidv4() });

// Razorpay
const options = { ...params, idempotency_key: uuidv4() };

// Raw HTTP (any payment provider)
await fetch('https://api.provider.com/v1/charges', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Idempotency-Key': uuidv4(),
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(params),
});
```

## Key implementation details
- Generate the idempotency key **before** the API call and persist it with the order
- Reuse the same key on retries — the whole point is that the same key returns the same result
- Store key in `payment_attempts` table: `{ orderId, idempotencyKey, status, chargeId }`
- Before creating a new charge, check if a key for this order already succeeded
- UUID v4 is the correct choice — not sequential IDs, not timestamps

## References
- https://stripe.com/docs/api/idempotent_requests
- https://razorpay.com/docs/payments/idempotency/
