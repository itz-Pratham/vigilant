# GDPR-Compliant Logging: No PII in Logs

## Why it matters
GDPR Article 5(1)(c) requires "data minimisation" — collect only what is necessary. Logs with PII are typically:
- Stored unencrypted
- Accessible to all engineers
- Retained for months or years
- Exported to third-party tools (Datadog, Splunk, Logtail)

This makes every log record a potential GDPR violation. ICO fines can reach 4% of global annual turnover.

## What counts as PII in logs
- Full name, email, phone number
- IP address (in most EU interpretations)
- User ID combined with behavioral data (borderline — document your position)
- Card numbers, bank account details (also PCI DSS scope)
- Government IDs, health data, biometric data

## How to implement

```typescript
// Replace PII with pseudonymous identifiers in logs
logger.info('User authenticated', {
  userId: user.id,     // pseudonymous — OK
  // email: user.email  ← NEVER
  // phone: user.phone  ← NEVER
  sessionId,
  ipHash: crypto.createHash('sha256').update(req.ip).digest('hex').slice(0, 16),  // hashed IP
});

// Automated PII stripping middleware
const PII_FIELDS = ['email', 'phone', 'name', 'firstName', 'lastName', 'address', 'cardNumber', 'ssn'];
function stripPII(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, PII_FIELDS.includes(k) ? '[REDACTED]' : v])
  );
}
```

## References
- https://gdpr.eu/article-5-how-personal-data-be-processed/
- https://ico.org.uk/for-organisations/guide-to-data-protection/guide-to-the-general-data-protection-regulation-gdpr/principles/data-minimisation/
