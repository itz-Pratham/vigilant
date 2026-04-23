# Data Retention Policies

## Why it matters
GDPR Article 5(1)(e) requires that personal data be kept "no longer than is necessary." Retaining data indefinitely:
- Increases breach impact (more data exposed)
- Increases legal liability (you're liable for data you hold)
- Violates GDPR and ePrivacy Directive

## Retention reference by data type

| Data type | Recommended retention | Legal basis |
|---|---|---|
| Session tokens | 24–72 hours | Minimum necessary |
| Access logs | 90 days | Security monitoring |
| Payment records | 7 years | Financial regulation |
| User accounts (inactive) | 2 years after last login | Legitimate interest |
| Support tickets | 3 years | Contract |
| Analytics events (PII) | 13 months | Standard analytics |

## How to implement

```typescript
// Add deleted_at and expires_at to tables with PII
// ALTER TABLE sessions ADD COLUMN expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '3 days');
// ALTER TABLE users ADD COLUMN last_active_at TIMESTAMPTZ;

// Scheduled cleanup job (run daily)
async function runRetentionCleanup(): Promise<void> {
  // Delete expired sessions
  const sessions = await db.query(`DELETE FROM sessions WHERE expires_at < NOW() RETURNING id`);
  logger.info('Retention: deleted expired sessions', { count: sessions.rowCount });

  // Anonymise inactive users
  const cutoff = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString();
  const users = await db.query(
    `UPDATE users SET email = concat('anon_', id, '@deleted.local'), name = 'Deleted User', phone = NULL
     WHERE last_active_at < $1 AND deleted_at IS NULL RETURNING id`,
    [cutoff]
  );
  logger.info('Retention: anonymised inactive users', { count: users.rowCount });
}
```

## Key implementation details
- Run cleanup as a scheduled job (cron), not on-demand — data doesn't delete itself
- Log retention actions to the audit trail — proof of compliance
- Test cleanup jobs in CI with a seeded test database
- Document retention periods in your privacy policy

## References
- https://gdpr.eu/article-5-how-personal-data-be-processed/
- https://ico.org.uk/for-organisations/guide-to-data-protection/guide-to-the-general-data-protection-regulation-gdpr/principles/storage-limitation/
