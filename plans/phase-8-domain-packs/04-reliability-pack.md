# Phase 8 — Reliability Domain Pack

**File:** `src/packs/reliability.ts`

## Objective

Full implementation of the reliability domain pack: 5 `PatternRule` entries, 5 `FixStrategy` entries with TypeScript before/after examples.

---

## Implementation

```typescript
// src/packs/reliability.ts
import { join }       from 'path';
import { DomainPack } from '../types.js';

export const reliability: DomainPack = {
  id:      'reliability',
  name:    'Reliability Domain Pack',
  version: '1.0.0',
  knowledgeSeedDir: join(import.meta.dirname, '../../knowledge/reliability'),
  ciDetectedTypes:  [],

  patternRules: [
    {
      issueType:    'MISSING_TIMEOUT',
      label:        'Outbound HTTP call without timeout',
      severity:     'HIGH',
      searchQuery:  'repo:{owner}/{repo} axios.get OR axios.post OR fetch NOT timeout language:TypeScript',
      filePatterns: ['*client*', '*service*', '*api*', '*http*', '*.ts'],
    },
    {
      issueType:    'NO_CIRCUIT_BREAKER',
      label:        'External service call without circuit breaker',
      severity:     'HIGH',
      searchQuery:  'repo:{owner}/{repo} axios OR got OR fetch NOT opossum NOT CircuitBreaker NOT Brakes language:TypeScript',
      filePatterns: ['*service*', '*client*', '*external*', '*integration*'],
    },
    {
      issueType:    'UNHANDLED_PROMISE',
      label:        'Floating promise without await, catch, or void',
      severity:     'MEDIUM',
      searchQuery:  'repo:{owner}/{repo} .then( NOT .catch( NOT await NOT void language:TypeScript',
      filePatterns: ['*.ts', '*.js'],
    },
    {
      issueType:    'MISSING_RETRY_LOGIC',
      label:        'Transient network call with no retry on 5xx',
      severity:     'MEDIUM',
      searchQuery:  'repo:{owner}/{repo} axios.post OR fetch NOT retry NOT p-retry NOT axios-retry language:TypeScript',
      filePatterns: ['*service*', '*client*', '*api*'],
    },
    {
      issueType:    'N_PLUS_ONE_QUERY',
      label:        'ORM find inside a loop without batch/include',
      severity:     'HIGH',
      searchQuery:  'repo:{owner}/{repo} for await OR forEach await findOne OR findById language:TypeScript',
      filePatterns: ['*service*', '*repository*', '*resolver*', '*.ts'],
    },
  ],

  fixStrategies: [
    {
      issueType:   'MISSING_TIMEOUT',
      severity:    'HIGH',
      description: 'HTTP calls without timeouts hang indefinitely on slow or unresponsive upstreams, blocking threads and exhausting connection pools.',
      badExample:
`const resp = await axios.get('https://api.example.com/data');`,
      goodExample:
`const resp = await axios.get('https://api.example.com/data', {
  timeout: 5_000,   // 5 seconds — fail fast on slow upstream
});`,
    },
    {
      issueType:   'NO_CIRCUIT_BREAKER',
      severity:    'HIGH',
      description: 'Without a circuit breaker, a failing dependency causes cascading failures across the entire service under load.',
      badExample:
`async function getUser(id: string) {
  return axios.get(\`https://user-service/users/\${id}\`);
}`,
      goodExample:
`import CircuitBreaker from 'opossum';

const breaker = new CircuitBreaker(
  (id: string) => axios.get(\`https://user-service/users/\${id}\`),
  { timeout: 3000, errorThresholdPercentage: 50, resetTimeout: 30000 }
);

async function getUser(id: string) {
  return breaker.fire(id);
}`,
    },
    {
      issueType:   'UNHANDLED_PROMISE',
      severity:    'MEDIUM',
      description: 'Floating promises (no await, no .catch) silently fail — errors are swallowed and the caller never knows.',
      badExample:
`function sendNotification(userId: string) {
  emailService.send(userId, 'Welcome');  // floating promise
}`,
      goodExample:
`function sendNotification(userId: string): void {
  emailService.send(userId, 'Welcome').catch(err => {
    logger.error('Notification failed', { userId, error: err.message });
  });
}`,
    },
    {
      issueType:   'MISSING_RETRY_LOGIC',
      severity:    'MEDIUM',
      description: 'Transient network errors (5xx, ECONNRESET) succeed on retry. Without retry logic, intermittent failures become user-visible errors.',
      badExample:
`const data = await axios.post('https://analytics-service/events', payload);`,
      goodExample:
`import pRetry from 'p-retry';

const data = await pRetry(
  () => axios.post('https://analytics-service/events', payload),
  {
    retries: 3,
    onFailedAttempt: err => logger.warn(\`Attempt \${err.attemptNumber} failed\`),
  }
);`,
    },
    {
      issueType:   'N_PLUS_ONE_QUERY',
      severity:    'HIGH',
      description: 'Calling a database query inside a loop sends N queries when 1 batch query would suffice. Causes linear performance degradation under load.',
      badExample:
`for (const order of orders) {
  const user = await User.findById(order.userId);  // N queries
  console.log(user.name, order.total);
}`,
      goodExample:
`const userIds = orders.map(o => o.userId);
const users   = await User.findAll({ where: { id: userIds } });  // 1 query
const userMap = new Map(users.map(u => [u.id, u]));

for (const order of orders) {
  const user = userMap.get(order.userId);
  console.log(user?.name, order.total);
}`,
    },
  ],
};
```
