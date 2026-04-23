# Phase 8 — Knowledge Seed Files

**Files:** `knowledge/{domain}/*.md` — 5 files per domain (20 total)

## Objective

Seed the RAG knowledge base with authoritative best-practice content for each domain. These files are loaded once per repo on first `vigilant start` via `loadDomainSeeds()`. They give the agent a knowledge base without requiring any internet access at scan time.

---

## File List and Content Outline

### `knowledge/payments/01-idempotency.md`

```markdown
# Idempotency in Payment APIs

## Why it matters
Payment APIs are called over unreliable networks. If a charge creation request times out,
the client cannot know if the server processed it. Without idempotency, retrying creates
duplicate charges.

## How to implement
- Generate a UUID per payment attempt: `uuidv4()`
- Pass as `Idempotency-Key` header (raw HTTP) or `idempotencyKey` param (Stripe SDK)
- Store the key with the charge record — same key = same result, no duplicate

## Stripe SDK example
```typescript
await stripe.charges.create(params, { idempotencyKey: uuidv4() });
```

## Razorpay example
```typescript
const options = { ...params, idempotency_key: uuidv4() };
```

## Storage pattern
Store the idempotency key in a `payment_attempts` table with the order ID.
Before creating a charge, check if a key for this order already succeeded.
```

---

### `knowledge/payments/02-webhook-security.md`

```markdown
# Webhook Signature Verification

## Why it matters
Webhooks are unauthenticated HTTP callbacks — any actor can POST to your webhook URL.
Without signature verification, attackers can send fake payment success events.

## Stripe HMAC verification
```typescript
const event = stripe.webhooks.constructEvent(
  rawBody,                            // Buffer, not parsed JSON
  req.headers['stripe-signature'],
  process.env.WEBHOOK_SECRET,
);
```

## Key implementation details
- Always use `express.raw()` before the webhook route — parsed body breaks signature
- Verify before doing ANY business logic
- Log and return 400 on signature mismatch — never process unverified events
- Rotate webhook secrets quarterly
```

---

### `knowledge/payments/03-error-handling.md`
```markdown
# Payment Error Handling Patterns

## Error categories
- **Terminal errors**: INSUFFICIENT_FUNDS, CARD_DECLINED, EXPIRED_CARD → do not retry
- **Transient errors**: NETWORK_ERROR, RATE_LIMIT → safe to retry with backoff
- **Unknown errors**: log and surface to human — do not assume safe or terminal

## Pattern: typed error result
```typescript
type PaymentResult = { success: true; chargeId: string } | { success: false; code: string; message: string };
```

## Never swallow errors silently
`catch(e) {}` is the most dangerous pattern in payment code.
Every caught error must be: logged + rethrown OR returned as a typed failure.
```

---

### `knowledge/payments/04-retries.md`
```markdown
# Safe Retry Patterns for Payment APIs

## Terminal vs transient error codes

| Code | Type | Retry? |
|---|---|---|
| insufficient_funds | Terminal | Never |
| card_declined | Terminal | Never |
| rate_limit | Transient | Yes, after 1s |
| network_error | Transient | Yes, exponential backoff |

## Implementation
```typescript
const TERMINAL = new Set(['insufficient_funds', 'card_declined', 'do_not_honor']);
await retry(() => stripe.charges.create(params), {
  retries: 3,
  factor:  2,
  minTimeout: 1000,
  shouldRetry: (err) => !TERMINAL.has(err.code),
});
```
```

---

### `knowledge/payments/05-sdk-versions.md`
```markdown
# Payment SDK Version Management

## Why outdated SDKs are dangerous
Payment SDKs receive security patches for API changes, TLS updates, and CVE fixes.
Running behind by ≥1 minor version risks:
- Missing security patches
- Using deprecated API fields
- Incompatibility with new webhook event types

## How to stay current
1. Use `npm outdated` to list outdated payment packages
2. Read the SDK changelog before upgrading (breaking changes in major versions)
3. Add a monthly Renovate or Dependabot check for payment packages
4. Run full payment integration tests after each upgrade

## Key packages to watch
- `stripe` — check https://github.com/stripe/stripe-node/releases
- `razorpay` — check https://github.com/razorpay/razorpay-node/releases
```

---

## Knowledge Seed Strategy

All 20 files follow the same structure:
1. **Why it matters** — business/security impact
2. **How to implement** — TypeScript code example
3. **Key implementation details** — gotchas and edge cases
4. **References** — links to authoritative docs (Stripe, OWASP, ICO, etc.)

The remaining 15 files (security: 5, reliability: 5, compliance: 5) follow the same pattern and are implemented directly in `knowledge/{domain}/`. Their content mirrors the `FixStrategy` description and good example from the domain pack.

---

## Loading in Code

These files are loaded by `loadDomainSeeds()` (defined in `01-interface.md`):

```typescript
// On first start per repo, for each active pack:
await loadDomainSeeds(pack, neurolink, db);
```

The `learned_urls` dedup table ensures they are only loaded once, even across restarts.
