# Phase 8 — Payments Domain Pack

**File:** `src/packs/payments.ts`

## Objective

Full implementation of the payments domain pack: 7 `PatternRule` entries, 7 `FixStrategy` entries with TypeScript before/after examples, and the knowledge seed directory path.

---

## Implementation

```typescript
// src/packs/payments.ts
import { join }       from 'path';
import { DomainPack } from '../types.js';

export const payments: DomainPack = {
  id:      'payments',
  name:    'Payments Domain Pack',
  version: '1.0.0',
  knowledgeSeedDir: join(import.meta.dirname, '../../knowledge/payments'),
  ciDetectedTypes:  ['CI_PAYMENT_FAILURE'],

  patternRules: [
    {
      issueType:    'MISSING_IDEMPOTENCY',
      label:        'Payment call without idempotency key',
      severity:     'CRITICAL',
      searchQuery:  'repo:{owner}/{repo} charges.create NOT idempotencyKey language:TypeScript',
      filePatterns: ['*payment*', '*charge*', '*billing*', '*checkout*'],
    },
    {
      issueType:    'WEBHOOK_NO_SIGNATURE',
      label:        'Webhook handler without HMAC signature verification',
      severity:     'CRITICAL',
      searchQuery:  'repo:{owner}/{repo} webhook NOT stripe-signature NOT x-hub-signature language:TypeScript',
      filePatterns: ['*webhook*', '*hook*', '*callback*', '*notify*'],
    },
    {
      issueType:    'SILENT_ERROR_SWALLOW',
      label:        'Payment error silently swallowed',
      severity:     'HIGH',
      searchQuery:  'repo:{owner}/{repo} catch language:TypeScript payment OR charge OR stripe',
      filePatterns: ['*payment*', '*charge*', '*transaction*'],
    },
    {
      issueType:    'RETRY_ON_TERMINAL_ERROR',
      label:        'Retrying on terminal payment error code',
      severity:     'HIGH',
      searchQuery:  'repo:{owner}/{repo} INSUFFICIENT_FUNDS OR CARD_DECLINED retry language:TypeScript',
      filePatterns: ['*payment*', '*retry*', '*charge*'],
    },
    {
      issueType:    'SDK_VERSION_DRIFT',
      label:        'Payment SDK version behind latest by ≥1 minor version',
      severity:     'MEDIUM',
      searchQuery:  '',   // dependency scanner uses package.json diff, not code search
      filePatterns: ['package.json'],
      ciKeywords:   [],
    },
    {
      issueType:    'CI_PAYMENT_FAILURE',
      label:        'Payment test suite failed in CI',
      severity:     'HIGH',
      searchQuery:  '',   // CI scanner only
      filePatterns: [],
      ciKeywords:   ['payment', 'checkout', 'stripe', 'razorpay', 'billing', 'charge'],
    },
    {
      issueType:    'MISSING_TIMEOUT',
      label:        'Payment API call without explicit timeout',
      severity:     'HIGH',
      searchQuery:  'repo:{owner}/{repo} stripe.charges OR axios.post NOT timeout language:TypeScript',
      filePatterns: ['*payment*', '*api*', '*client*'],
    },
  ],

  fixStrategies: [
    {
      issueType:   'MISSING_IDEMPOTENCY',
      severity:    'CRITICAL',
      description: 'Payment API calls without idempotency keys risk duplicate charges when requests are retried.',
      badExample:
`await stripe.charges.create({
  amount:   1000,
  currency: 'usd',
  source:   token,
});`,
      goodExample:
`import { v4 as uuidv4 } from 'uuid';

await stripe.charges.create({
  amount:        1000,
  currency:      'usd',
  source:        token,
  idempotencyKey: uuidv4(),  // unique per charge attempt
});`,
      searchQuery: 'repo:{owner}/{repo} charges.create NOT idempotencyKey language:TypeScript',
    },
    {
      issueType:   'WEBHOOK_NO_SIGNATURE',
      severity:    'CRITICAL',
      description: 'Webhook endpoints without HMAC verification accept forged events from any source.',
      badExample:
`app.post('/webhook', (req, res) => {
  const event = req.body;
  handleEvent(event);
  res.sendStatus(200);
});`,
      goodExample:
`app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send('Webhook signature verification failed');
  }
  handleEvent(event);
  res.sendStatus(200);
});`,
    },
    {
      issueType:   'SILENT_ERROR_SWALLOW',
      severity:    'HIGH',
      description: 'Catching payment errors without rethrowing or returning a failure hides charge failures from callers.',
      badExample:
`try {
  await stripe.charges.create(params);
} catch (e) {}`,
      goodExample:
`try {
  await stripe.charges.create(params);
} catch (e: any) {
  logger.error('Payment failed', { error: e.message, code: e.code });
  throw new PaymentError(e.message, e.code);
}`,
    },
    {
      issueType:   'RETRY_ON_TERMINAL_ERROR',
      severity:    'HIGH',
      description: 'Retrying on terminal decline codes (INSUFFICIENT_FUNDS, CARD_DECLINED) wastes API calls and may trigger fraud flags.',
      badExample:
`const TERMINAL_CODES = ['insufficient_funds', 'card_declined'];
// Missing: no check before retry
await retry(() => stripe.charges.create(params), { retries: 3 });`,
      goodExample:
`const TERMINAL_CODES = new Set(['insufficient_funds', 'card_declined', 'expired_card']);

await retry(
  () => stripe.charges.create(params),
  {
    retries: 3,
    shouldRetry: (err) => !TERMINAL_CODES.has(err.code),
  },
);`,
    },
    {
      issueType:   'MISSING_TIMEOUT',
      severity:    'HIGH',
      description: 'Payment API calls without timeouts can hang indefinitely on network issues, blocking threads and exhausting connection pools.',
      badExample:
`const charge = await axios.post('https://api.stripe.com/v1/charges', data);`,
      goodExample:
`const charge = await axios.post('https://api.stripe.com/v1/charges', data, {
  timeout: 10_000,   // 10 second timeout — fail fast
});`,
    },
    {
      issueType:   'SDK_VERSION_DRIFT',
      severity:    'MEDIUM',
      description: 'Using an outdated payment SDK version misses security patches and API improvements.',
      badExample:  `"stripe": "^12.0.0"   // package.json — 3 minor versions behind`,
      goodExample: `"stripe": "^15.0.0"   // package.json — updated to latest`,
    },
    {
      issueType:   'CI_PAYMENT_FAILURE',
      severity:    'HIGH',
      description: 'A payment-related test suite is failing in the most recent GitHub Actions run.',
      badExample:  `// CI output: FAIL src/payment.test.ts — 3 failed, 12 passed`,
      goodExample: `// All payment tests pass before merge`,
    },
  ],
};
```
