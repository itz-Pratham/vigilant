# GDPR Right to Erasure (Article 17)

## Why it matters
GDPR Article 17 grants data subjects the right to request deletion of their personal data. Organisations must be able to delete or anonymise personal data across all systems — database, backups, logs, analytics — within 30 days of a request.

## How to implement

```typescript
// Anonymisation (preferred over deletion — preserves referential integrity)
async function anonymiseUser(userId: string): Promise<void> {
  await db.transaction(async (trx) => {
    // Replace PII with anonymised placeholders
    await trx.query(
      `UPDATE users SET
        email       = concat('deleted_', id, '@anon.local'),
        name        = 'Deleted User',
        phone       = NULL,
        address     = NULL,
        deleted_at  = NOW()
       WHERE id = $1`,
      [userId]
    );
    // Mark related records that contain PII
    await trx.query(`UPDATE payment_methods SET card_last_four = '****', deleted_at = NOW() WHERE user_id = $1`, [userId]);
    // Log the erasure for compliance evidence
    await trx.query(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id) VALUES ('system', 'GDPR_ERASURE', 'user', $1)`,
      [userId]
    );
  });
}
```

## Key implementation details
- Anonymise rather than hard-delete when foreign key constraints exist
- Run as a transaction — partial erasure is worse than no erasure
- Log the erasure in the audit trail — you need proof of compliance
- Schedule a test for your erasure flow in CI — it must not break with schema changes
- Check all related tables: sessions, orders, payments, analytics events

## References
- https://gdpr.eu/article-17-right-to-be-forgotten/
- https://ico.org.uk/for-organisations/guide-to-data-protection/guide-to-the-general-data-protection-regulation-gdpr/individual-rights/right-to-erasure/
