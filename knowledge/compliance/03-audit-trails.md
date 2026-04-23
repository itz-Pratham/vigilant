# Audit Trail Implementation

## Why it matters
GDPR, PCI DSS, SOC 2, and financial regulations require audit trails for sensitive data mutations. Without one, you cannot answer: who deleted this user? who changed this payment method? who accessed this medical record?

## How to implement

```typescript
// Audit log schema (SQL)
// CREATE TABLE audit_log (
//   id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   actor_id    TEXT NOT NULL,           -- who
//   action      TEXT NOT NULL,           -- what ('UPDATE', 'DELETE', 'VIEW')
//   entity_type TEXT NOT NULL,           -- which table ('user', 'payment_method')
//   entity_id   TEXT NOT NULL,           -- which record
//   changes     JSONB,                   -- before/after snapshot (no PII in values if possible)
//   ip_address  TEXT,
//   occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
// );
// CREATE INDEX ON audit_log (entity_type, entity_id);
// CREATE INDEX ON audit_log (actor_id);

async function auditedUpdate<T>(
  entityType: string,
  entityId: string,
  actorId: string,
  updateFn: () => Promise<T>
): Promise<T> {
  const result = await updateFn();
  await db.query(
    `INSERT INTO audit_log (actor_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4)`,
    [actorId, 'UPDATE', entityType, entityId]
  );
  return result;
}
```

## Key implementation details
- Audit log is append-only — never update or delete audit records
- Use a separate DB user for audit log writes with INSERT-only permissions
- Store `occurred_at` in UTC, not local time
- `changes` column: log field names changed, not values, if values contain PII

## References
- https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html#which-events-to-log
- https://www.pcisecuritystandards.org/document_library/
