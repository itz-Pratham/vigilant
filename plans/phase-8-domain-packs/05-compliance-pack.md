# Phase 8 — Compliance Domain Pack

**File:** `src/packs/compliance.ts`

## Objective

Full implementation of the compliance domain pack: 5 `PatternRule` entries, 5 `FixStrategy` entries with TypeScript before/after examples targeting GDPR, PII protection, and audit trail requirements.

---

## Implementation

```typescript
// src/packs/compliance.ts
import { join }       from 'path';
import { DomainPack } from '../types.js';

export const compliance: DomainPack = {
  id:      'compliance',
  name:    'Compliance Domain Pack',
  version: '1.0.0',
  knowledgeSeedDir: join(import.meta.dirname, '../../knowledge/compliance'),
  ciDetectedTypes:  [],

  patternRules: [
    {
      issueType:    'PII_IN_LOGS',
      label:        'Personal data in log output',
      severity:     'HIGH',
      searchQuery:  'repo:{owner}/{repo} logger OR console.log email OR phone OR ssn OR dob language:TypeScript',
      filePatterns: ['*.ts', '*.js'],
    },
    {
      issueType:    'UNENCRYPTED_PII_STORAGE',
      label:        'Sensitive field stored as plaintext',
      severity:     'CRITICAL',
      searchQuery:  'repo:{owner}/{repo} String OR TEXT ssn OR dateOfBirth OR socialSecurity language:TypeScript',
      filePatterns: ['*schema*', '*model*', '*entity*', '*migration*'],
    },
    {
      issueType:    'MISSING_AUDIT_TRAIL',
      label:        'Mutation on sensitive record without audit log',
      severity:     'HIGH',
      searchQuery:  'repo:{owner}/{repo} User.update OR User.delete NOT auditLog NOT audit NOT logEvent language:TypeScript',
      filePatterns: ['*service*', '*repository*', '*controller*'],
    },
    {
      issueType:    'GDPR_RIGHT_TO_DELETE_GAP',
      label:        'User entity with no delete or anonymise pathway',
      severity:     'HIGH',
      searchQuery:  'repo:{owner}/{repo} User OR Profile NOT deleteUser NOT anonymiseUser NOT hardDelete language:TypeScript',
      filePatterns: ['*user*', '*profile*', '*account*', '*service*'],
    },
    {
      issueType:    'MISSING_DATA_RETENTION_POLICY',
      label:        'Table with sensitive data and no cleanup job or TTL',
      severity:     'MEDIUM',
      searchQuery:  'repo:{owner}/{repo} CREATE TABLE OR Schema personal OR sensitive NOT TTL NOT expires_at NOT cleanup language:TypeScript',
      filePatterns: ['*migration*', '*schema*', '*model*'],
    },
  ],

  fixStrategies: [
    {
      issueType:   'PII_IN_LOGS',
      severity:    'HIGH',
      description: 'Logging PII (email, phone, SSN, date of birth) creates GDPR liability and leaks personal data to log aggregators, monitoring tools, and anyone with log access.',
      badExample:
`logger.info('User registered', {
  email: user.email,
  phone: user.phone,
  dob:   user.dateOfBirth,
});`,
      goodExample:
`logger.info('User registered', {
  userId:    user.id,           // internal identifier — safe
  timestamp: new Date().toISOString(),
});`,
    },
    {
      issueType:   'UNENCRYPTED_PII_STORAGE',
      severity:    'CRITICAL',
      description: 'Storing sensitive fields (SSN, bank account, medical data) as plaintext means any DB breach exposes the data directly.',
      badExample:
`// TypeORM entity
@Column()
ssn: string;   // stored as plaintext

@Column()
dateOfBirth: string;`,
      goodExample:
`import { encrypt, decrypt } from '../utils/crypto.js';

@Column({ transformer: { to: encrypt, from: decrypt } })
ssn: string;   // encrypted at rest via column transformer

@Column()
dateOfBirthHash: string;  // hashed for lookup; original not stored`,
    },
    {
      issueType:   'MISSING_AUDIT_TRAIL',
      severity:    'HIGH',
      description: 'GDPR and many financial regulations require an immutable record of who changed sensitive data and when.',
      badExample:
`async function deleteUser(userId: string): Promise<void> {
  await db.user.delete({ where: { id: userId } });
}`,
      goodExample:
`async function deleteUser(userId: string, actorId: string): Promise<void> {
  await db.auditLog.create({
    data: {
      action:    'DELETE',
      entityType: 'User',
      entityId:  userId,
      actorId,
      timestamp: new Date(),
    },
  });
  await db.user.delete({ where: { id: userId } });
}`,
    },
    {
      issueType:   'GDPR_RIGHT_TO_DELETE_GAP',
      severity:    'HIGH',
      description: 'GDPR Article 17 requires that users can request erasure of their personal data. Missing a delete or anonymise pathway makes compliance impossible.',
      badExample:
`// No deleteUser or anonymiseUser function exists in the codebase`,
      goodExample:
`async function anonymiseUser(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: {
      email:     \`deleted-\${userId}@deleted.invalid\`,
      name:      '[Deleted User]',
      phone:     null,
      deletedAt: new Date(),
    },
  });
  // Cascade: delete or anonymise related records (orders, addresses, sessions)
  await deleteUserOrders(userId);
  await deleteUserSessions(userId);
}`,
    },
    {
      issueType:   'MISSING_DATA_RETENTION_POLICY',
      severity:    'MEDIUM',
      description: 'Tables containing personal data without a TTL or cleanup job accumulate data indefinitely, increasing breach impact and GDPR scope.',
      badExample:
`// audit_logs table: stores user actions including PII, no cleanup ever runs`,
      goodExample:
`// Migration: add expires_at to audit_logs
await db.schema.alterTable('audit_logs', (t) => {
  t.timestamp('expires_at').notNullable().defaultTo(
    db.raw("NOW() + INTERVAL '2 years'")
  );
});

// Cron job (runs nightly):
async function cleanExpiredAuditLogs(): Promise<void> {
  await db('audit_logs').where('expires_at', '<', new Date()).delete();
  logger.info('Expired audit logs cleaned');
}`,
    },
  ],
};
```
