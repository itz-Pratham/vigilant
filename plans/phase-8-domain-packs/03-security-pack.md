# Phase 8 — Security Domain Pack

**File:** `src/packs/security.ts`

## Objective

Full implementation of the security domain pack: 5 `PatternRule` entries, 5 `FixStrategy` entries with TypeScript before/after examples.

---

## Implementation

```typescript
// src/packs/security.ts
import { join }       from 'path';
import { DomainPack } from '../types.js';

export const security: DomainPack = {
  id:      'security',
  name:    'Security Domain Pack',
  version: '1.0.0',
  knowledgeSeedDir: join(import.meta.dirname, '../../knowledge/security'),
  ciDetectedTypes:  [],

  patternRules: [
    {
      issueType:    'SECRET_IN_CODE',
      label:        'API key or secret literal in source file',
      severity:     'CRITICAL',
      searchQuery:  'repo:{owner}/{repo} sk_live OR pk_live OR apiKey= NOT process.env language:TypeScript',
      filePatterns: ['*.ts', '*.js', '*.json', '*config*', '*.env*'],
    },
    {
      issueType:    'MISSING_AUTH_CHECK',
      label:        'Route handler without authentication middleware',
      severity:     'HIGH',
      searchQuery:  'repo:{owner}/{repo} router.post OR router.put OR router.delete NOT authenticate NOT verifyToken NOT requireAuth language:TypeScript',
      filePatterns: ['*route*', '*controller*', '*handler*', '*api*'],
    },
    {
      issueType:    'SQL_INJECTION_RISK',
      label:        'Raw string interpolation into SQL query',
      severity:     'CRITICAL',
      searchQuery:  'repo:{owner}/{repo} SELECT * FROM ${  language:TypeScript',
      filePatterns: ['*repository*', '*db*', '*database*', '*query*', '*.ts'],
    },
    {
      issueType:    'PII_IN_LOGS',
      label:        'Personal data passed to logger',
      severity:     'HIGH',
      searchQuery:  'repo:{owner}/{repo} logger.info OR console.log email OR phone OR cardNumber language:TypeScript',
      filePatterns: ['*.ts', '*.js'],
    },
    {
      issueType:    'UNVALIDATED_INPUT',
      label:        'User input used without schema validation',
      severity:     'HIGH',
      searchQuery:  'repo:{owner}/{repo} req.body NOT z.parse NOT Joi.validate NOT validate language:TypeScript',
      filePatterns: ['*route*', '*controller*', '*handler*', '*api*'],
    },
  ],

  fixStrategies: [
    {
      issueType:   'SECRET_IN_CODE',
      severity:    'CRITICAL',
      description: 'Hardcoded secrets in source files are exposed in git history, CI logs, and to anyone with read access. Always load from environment variables.',
      badExample:
`const stripe = new Stripe('sk_live_abc123xyz789');`,
      goodExample:
`const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});
// Add to .env.example: STRIPE_SECRET_KEY=`,
    },
    {
      issueType:   'MISSING_AUTH_CHECK',
      severity:    'HIGH',
      description: 'Mutation endpoints (POST/PUT/DELETE) without auth middleware allow unauthenticated users to modify or delete data.',
      badExample:
`router.delete('/users/:id', async (req, res) => {
  await User.delete(req.params.id);
  res.sendStatus(204);
});`,
      goodExample:
`router.delete('/users/:id', authenticate, authorize('admin'), async (req, res) => {
  await User.delete(req.params.id);
  res.sendStatus(204);
});`,
    },
    {
      issueType:   'SQL_INJECTION_RISK',
      severity:    'CRITICAL',
      description: 'Raw string interpolation into SQL queries allows injection attacks. Always use parameterized queries.',
      badExample:
`const result = await db.query(
  \`SELECT * FROM users WHERE email = '\${req.body.email}'\`
);`,
      goodExample:
`const result = await db.query(
  'SELECT * FROM users WHERE email = $1',
  [req.body.email]   // parameterized — safe
);`,
    },
    {
      issueType:   'PII_IN_LOGS',
      severity:    'HIGH',
      description: 'Logging emails, phones, or card numbers creates GDPR compliance risk and leaks PII to log aggregators.',
      badExample:
`logger.info('User login', { email: user.email, phone: user.phone });`,
      goodExample:
`logger.info('User login', {
  userId:    user.id,          // safe — internal identifier only
  userAgent: req.headers['user-agent'],
});`,
    },
    {
      issueType:   'UNVALIDATED_INPUT',
      severity:    'HIGH',
      description: 'Using req.body without schema validation allows malformed or malicious data to reach business logic.',
      badExample:
`router.post('/transfer', async (req, res) => {
  const { amount, toAccount } = req.body;
  await transfer(amount, toAccount);
});`,
      goodExample:
`import { z } from 'zod';

const TransferSchema = z.object({
  amount:    z.number().positive().max(1_000_000),
  toAccount: z.string().regex(/^[A-Z0-9]{10,20}$/),
});

router.post('/transfer', async (req, res) => {
  const { amount, toAccount } = TransferSchema.parse(req.body);
  await transfer(amount, toAccount);
});`,
    },
  ],
};
```
