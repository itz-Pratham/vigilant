# Preventing PII in Log Output

## Why it matters
Logs are typically stored unencrypted, accessible to many engineers, retained long-term, and often exported to third-party observability tools. PII in logs violates GDPR Article 5 (data minimisation) and creates a data breach risk every time logs are accessed.

## What counts as PII
- Email addresses, phone numbers, names
- Card numbers (even partial — last 4 is OK only in masked form: `****1234`)
- IP addresses (in some GDPR interpretations)
- Government IDs, SSNs, passport numbers
- Passwords, tokens, secrets (obvious but often forgotten)

## How to implement

```typescript
// WRONG — logs PII directly
logger.info('Processing payment', { email, cardNumber, amount });

// CORRECT — log identifiers, not PII
logger.info('Processing payment', { userId, maskedCard: `****${cardNumber.slice(-4)}`, amount });

// Structured logger with PII strip
const STRIP_FIELDS = ['email', 'phone', 'cardNumber', 'password', 'token', 'ssn'];

function sanitizeLogData(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) =>
      STRIP_FIELDS.includes(k) ? [k, '[REDACTED]'] : [k, v]
    )
  );
}
logger.info('Payment event', sanitizeLogData({ userId, email, amount }));
// → { userId: 'u_123', email: '[REDACTED]', amount: 5000 }
```

## References
- https://gdpr.eu/article-5-how-personal-data-be-processed/
- https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
