// src/agent/domain-context.ts
// Domain pack definitions and active pack resolver.

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { PatternRule } from '../watcher/types.js';
import type { VigilantConfig } from '../config/types.js';

const _dir = dirname(fileURLToPath(import.meta.url));
/** Absolute path to the knowledge/ directory at the repo root. */
const KNOWLEDGE_DIR = join(_dir, '../../knowledge');

/**
 * A fix strategy gives the agent example before/after code and investigation hints
 * for a specific issue type. Injected into the investigation system prompt.
 */
export type FixStrategy = {
  issueType:          string;
  explanation:        string;
  exampleBefore:      string;
  exampleAfter:       string;
  investigationHints: string[];
  priorityFiles:      string[];
};

/** A domain pack: defines what vigilant looks for in a specific domain. */
export type DomainPack = {
  /** Unique domain identifier, e.g. "payments" */
  id: string;
  /** Human-readable name */
  name: string;
  /** All issue type strings this pack can detect */
  issueTypes: string[];
  /** Pattern rules used by the PR, commit, and pattern scanners */
  patternRules: PatternRule[];
  /** Job name keywords used by the CI scanner */
  ciKeywords: string[];
  /** Fix strategies keyed by issueType — injected into agent system prompt */
  fixStrategies: Record<string, FixStrategy>;
  /**
   * Absolute path to the knowledge seed directory for this domain.
   * Seed .md files are loaded into the RAG knowledge base on first startup.
   * Optional for backward compatibility — existing packs without seeds still work.
   */
  knowledgeSeedDir?: string;
};

// ── Built-in domain packs ─────────────────────────────────────────────────────

const PAYMENTS_PACK: DomainPack = {
  id:   'payments',
  name: 'Payments',
  knowledgeSeedDir: join(KNOWLEDGE_DIR, 'payments'),
  issueTypes: [
    'MISSING_IDEMPOTENCY_KEY',
    'UNVERIFIED_WEBHOOK',
    'SILENT_PAYMENT_ERROR',
    'RETRYING_TERMINAL_ERROR',
    'SDK_VERSION_DRIFT',
    'CI_PAYMENT_FAILURE',
    'MISSING_TIMEOUT',
  ],
  ciKeywords: ['payment', 'checkout', 'billing', 'stripe', 'order', 'transaction'],
  patternRules: [
    {
      id:              'payments-001',
      issueType:       'MISSING_IDEMPOTENCY_KEY',
      description:     'Payment API call without idempotency key',
      searchQuery:     '"createPayment" OR "processPayment" NOT "idempotencyKey" NOT "idempotency_key"',
      filePathPattern: '(payment|checkout|order|billing)',
      severity:        'HIGH',
      confidenceScore: 0.75,
      watchedFilePaths: ['**/payment*', '**/checkout*', '**/order*', '**/billing*'],
    },
    {
      id:              'payments-002',
      issueType:       'UNVERIFIED_WEBHOOK',
      description:     'Webhook endpoint without signature verification',
      searchQuery:     '"webhook" NOT "verifySignature" NOT "constructEvent" NOT "validateSignature"',
      filePathPattern: 'webhook',
      severity:        'CRITICAL',
      confidenceScore: 0.8,
      watchedFilePaths: ['**/webhook*', '**/hooks*'],
    },
    {
      id:              'payments-003',
      issueType:       'SILENT_PAYMENT_ERROR',
      description:     'Caught payment error without re-throw or alerting',
      searchQuery:     '"catch" NOT "throw" NOT "logger" NOT "alert" NOT "monitor"',
      filePathPattern: '(payment|checkout)',
      severity:        'HIGH',
      confidenceScore: 0.65,
      watchedFilePaths: ['**/payment*', '**/checkout*'],
    },
    {
      id:              'payments-004',
      issueType:       'RETRYING_TERMINAL_ERROR',
      description:     'Retrying a terminal payment error (e.g. card_declined)',
      searchQuery:     '"card_declined" OR "do_not_honor" AND "retry"',
      filePathPattern: '(payment|checkout|retry)',
      severity:        'HIGH',
      confidenceScore: 0.7,
      watchedFilePaths: ['**/payment*', '**/checkout*'],
    },
    {
      id:              'payments-005',
      issueType:       'SDK_VERSION_DRIFT',
      description:     'Payment SDK version significantly behind latest release',
      searchQuery:     '"stripe"',
      filePathPattern: 'package\\.json',
      severity:        'MEDIUM',
      confidenceScore: 0.6,
      watchedFilePaths: ['**/package.json'],
    },
    {
      id:              'payments-006',
      issueType:       'MISSING_TIMEOUT',
      description:     'Payment API call without explicit timeout — can hang indefinitely',
      searchQuery:     '"axios.post" OR "stripe.charges" NOT "timeout"',
      filePathPattern: '(payment|checkout|api|client)',
      severity:        'HIGH',
      confidenceScore: 0.65,
      watchedFilePaths: ['**/payment*', '**/checkout*', '**/api*', '**/client*'],
    },
  ],
  fixStrategies: {
    MISSING_IDEMPOTENCY_KEY: {
      issueType: 'MISSING_IDEMPOTENCY_KEY',
      explanation: 'Every payment API call must include an idempotency key to prevent duplicate charges on retries.',
      exampleBefore: `const result = await stripe.paymentIntents.create({ amount, currency });`,
      exampleAfter: `const result = await stripe.paymentIntents.create({ amount, currency }, { idempotencyKey: requestId });`,
      investigationHints: [
        'Find all files calling createPayment, processPayment, charge, or paymentIntents.create',
        'Check whether a request-id header or uuid is available in scope',
        'Look for existing idempotency patterns elsewhere in the codebase',
      ],
      priorityFiles: ['**/payment*', '**/checkout*', '**/order*', '**/billing*'],
    },
    UNVERIFIED_WEBHOOK: {
      issueType: 'UNVERIFIED_WEBHOOK',
      explanation: 'Webhook endpoints must verify the provider signature before processing the payload to prevent spoofed events.',
      exampleBefore: `app.post('/webhook', (req, res) => { handleEvent(req.body); });`,
      exampleAfter: `app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  const event = stripe.webhooks.constructEvent(req.body, sig, process.env.WEBHOOK_SECRET!);
  handleEvent(event);
  res.sendStatus(200);
});`,
      investigationHints: [
        'Identify all webhook receiver routes',
        'Check if raw body is preserved (required for HMAC verification)',
        'Find the webhook secret location (env var vs hardcoded)',
      ],
      priorityFiles: ['**/webhook*', '**/hooks*'],
    },
    SILENT_PAYMENT_ERROR: {
      issueType: 'SILENT_PAYMENT_ERROR',
      explanation: 'Caught payment errors must be rethrown or alerted — silently swallowing them hides outages.',
      exampleBefore: `try { await charge(amount); } catch (e) { /* ignore */ }`,
      exampleAfter: `try { await charge(amount); } catch (e: unknown) { logger.error('charge failed', { error: e }); throw e; }`,
      investigationHints: [
        'Find all try/catch blocks in payment files',
        'Check what error handling utilities exist in the codebase',
        'Look for monitoring/alert integrations already in use',
      ],
      priorityFiles: ['**/payment*', '**/checkout*'],
    },
    RETRYING_TERMINAL_ERROR: {
      issueType: 'RETRYING_TERMINAL_ERROR',
      explanation: 'Terminal error codes like card_declined or do_not_honor must not be retried — they will always fail.',
      exampleBefore: `while (retries > 0) { try { return await charge(); } catch(e) { retries--; } }`,
      exampleAfter: `const TERMINAL = new Set(['card_declined', 'do_not_honor', 'insufficient_funds']);
if (TERMINAL.has(err.code)) throw err; // never retry terminal errors
// only retry transient errors`,
      investigationHints: [
        'Find the retry loop and the error codes being handled',
        'Check Stripe/payment provider docs for terminal vs transient error codes',
        'Look for an existing error-code enum or constant file',
      ],
      priorityFiles: ['**/payment*', '**/checkout*', '**/retry*'],
    },
    SDK_VERSION_DRIFT: {
      issueType: 'SDK_VERSION_DRIFT',
      explanation: 'Using an outdated payment SDK version misses security patches and may use deprecated API fields.',
      exampleBefore: `"stripe": "^12.0.0"   // package.json — multiple versions behind`,
      exampleAfter: `"stripe": "^15.0.0"   // package.json — updated to latest stable`,
      investigationHints: [
        'Run npm outdated to find how far behind the SDK version is',
        'Check the SDK changelog for breaking changes before upgrading',
        'Review payment integration tests before and after upgrading',
      ],
      priorityFiles: ['**/package.json'],
    },
    MISSING_TIMEOUT: {
      issueType: 'MISSING_TIMEOUT',
      explanation: 'Payment API calls without timeouts can hang indefinitely, blocking threads and exhausting connection pools.',
      exampleBefore: `const charge = await axios.post('https://api.stripe.com/v1/charges', data);`,
      exampleAfter: `const charge = await axios.post('https://api.stripe.com/v1/charges', data, {
  timeout: 10_000,  // 10 second timeout — fail fast on slow upstream
});`,
      investigationHints: [
        'Find all axios.post / axios.get calls to payment endpoints',
        'Check if an axios instance is configured globally — add timeout there',
        'Verify timeout value matches the payment provider SLA',
      ],
      priorityFiles: ['**/payment*', '**/checkout*', '**/api*', '**/client*'],
    },
    CI_PAYMENT_FAILURE: {
      issueType: 'CI_PAYMENT_FAILURE',
      explanation: 'A payment-related test suite is failing in the most recent CI run. Fix before merging.',
      exampleBefore: `// CI: FAIL src/payment.test.ts — 3 failed, 12 passed`,
      exampleAfter: `// All payment tests pass; no skipped tests`,
      investigationHints: [
        'Check the GitHub Actions run logs for the failing test names',
        'Reproduce locally with: npm test -- --grep payment',
        'Check if the failure is a flaky test or a real regression',
      ],
      priorityFiles: ['**/payment*', '**/*.test.ts'],
    },
  },
};

const SECURITY_PACK: DomainPack = {
  id:   'security',
  name: 'Security',
  knowledgeSeedDir: join(KNOWLEDGE_DIR, 'security'),
  issueTypes: [
    'SECRET_IN_CODE',
    'MISSING_AUTH_CHECK',
    'SQL_INJECTION_RISK',
    'PII_IN_LOGS',
    'UNVALIDATED_INPUT',
    'CI_SECURITY_FAILURE',
  ],
  ciKeywords: ['security', 'auth', 'vulnerability', 'scan', 'sast', 'snyk'],
  patternRules: [
    {
      id:              'security-001',
      issueType:       'SECRET_IN_CODE',
      description:     'Hardcoded secret or API key in source',
      searchQuery:     '"api_key" OR "apiKey" OR "sk_live" NOT "process.env" NOT "os.environ"',
      filePathPattern: '\\.(ts|js|json)$',
      severity:        'CRITICAL',
      confidenceScore: 0.85,
      watchedFilePaths: ['**/*.ts', '**/*.js', '**/*.json'],
    },
    {
      id:              'security-002',
      issueType:       'MISSING_AUTH_CHECK',
      description:     'Route handler without authentication middleware',
      searchQuery:     '"router.post" OR "router.put" OR "router.delete" NOT "authenticate" NOT "requireAuth"',
      filePathPattern: '(routes|controllers|api|handler)',
      severity:        'HIGH',
      confidenceScore: 0.7,
      watchedFilePaths: ['**/routes*', '**/controllers*', '**/api*', '**/handler*'],
    },
    {
      id:              'security-003',
      issueType:       'SQL_INJECTION_RISK',
      description:     'Raw string interpolation into a SQL query',
      searchQuery:     '"SELECT" AND "${" language:TypeScript',
      filePathPattern: '(repository|db|database|query)',
      severity:        'CRITICAL',
      confidenceScore: 0.8,
      watchedFilePaths: ['**/repository*', '**/db*', '**/database*', '**/query*'],
    },
    {
      id:              'security-004',
      issueType:       'PII_IN_LOGS',
      description:     'PII field (email, phone, ssn) written to logger',
      searchQuery:     '"logger.info" OR "console.log" AND ("email" OR "phone" OR "ssn")',
      filePathPattern: '\\.(ts|js)$',
      severity:        'HIGH',
      confidenceScore: 0.7,
      watchedFilePaths: ['**/*.ts', '**/*.js'],
    },
    {
      id:              'security-005',
      issueType:       'UNVALIDATED_INPUT',
      description:     'req.body used without schema validation',
      searchQuery:     '"req.body" NOT "z.parse" NOT "Joi.validate" NOT "validate("',
      filePathPattern: '(routes|controllers|api|handler)',
      severity:        'HIGH',
      confidenceScore: 0.65,
      watchedFilePaths: ['**/routes*', '**/controllers*', '**/api*', '**/handler*'],
    },
  ],
  fixStrategies: {
    SECRET_IN_CODE: {
      issueType: 'SECRET_IN_CODE',
      explanation: 'Hardcoded secrets in source code are exposed in git history and to anyone with read access. Always load from environment variables.',
      exampleBefore: `const stripe = new Stripe('sk_live_abc123xyz789');`,
      exampleAfter: `const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
// .env.example: STRIPE_SECRET_KEY=sk_live_...`,
      investigationHints: [
        'Search for literal strings matching "sk_live", "pk_live", "apiKey =", "secret ="',
        'Check if the secret is already in a .env file and just needs process.env reference',
        'Rotate the secret immediately if it was ever committed to git history',
      ],
      priorityFiles: ['**/*.ts', '**/*.js', '**/*.json', '**/config*'],
    },
    MISSING_AUTH_CHECK: {
      issueType: 'MISSING_AUTH_CHECK',
      explanation: 'Mutation endpoints (POST/PUT/DELETE) without auth middleware allow unauthenticated access to sensitive data.',
      exampleBefore: `router.delete('/users/:id', async (req, res) => {
  await User.delete(req.params.id);
  res.sendStatus(204);
});`,
      exampleAfter: `router.delete('/users/:id', authenticate, authorize('admin'), async (req, res) => {
  await User.delete(req.params.id);
  res.sendStatus(204);
});`,
      investigationHints: [
        'Find all router.post / router.put / router.delete handlers',
        'Check the project for existing authenticate / requireAuth middleware',
        'Verify what auth tokens the client already sends in headers',
      ],
      priorityFiles: ['**/routes*', '**/controllers*', '**/api*'],
    },
    SQL_INJECTION_RISK: {
      issueType: 'SQL_INJECTION_RISK',
      explanation: 'Raw string interpolation into SQL queries allows injection attacks. Always use parameterized queries.',
      exampleBefore: `const result = await db.query(
  \`SELECT * FROM users WHERE email = '\${req.body.email}'\`
);`,
      exampleAfter: `const result = await db.query(
  'SELECT * FROM users WHERE email = $1',
  [req.body.email]  // parameterized — safe from injection
);`,
      investigationHints: [
        'Find all db.query / db.execute calls using template literals',
        'Check if the project uses an ORM that handles parameterization automatically',
        'Review all raw SQL queries for any user-controlled values',
      ],
      priorityFiles: ['**/repository*', '**/db*', '**/query*'],
    },
    PII_IN_LOGS: {
      issueType: 'PII_IN_LOGS',
      explanation: 'Logging PII creates GDPR compliance risk and leaks personal data to log aggregators accessible to engineers and third-party tools.',
      exampleBefore: `logger.info('User login', { email: user.email, phone: user.phone });`,
      exampleAfter: `logger.info('User login', {
  userId:    user.id,         // internal identifier — safe
  userAgent: req.headers['user-agent'],
});`,
      investigationHints: [
        'Grep for logger.info / console.log with email, phone, ssn, dob, cardNumber',
        'Check if a scrubber utility already exists in the codebase',
        'Review the logging config for any global field redaction',
      ],
      priorityFiles: ['**/*.ts', '**/*.js'],
    },
    UNVALIDATED_INPUT: {
      issueType: 'UNVALIDATED_INPUT',
      explanation: 'Using req.body directly without schema validation allows malformed or malicious data to reach business logic.',
      exampleBefore: `router.post('/transfer', async (req, res) => {
  const { amount, toAccount } = req.body;
  await transfer(amount, toAccount);
});`,
      exampleAfter: `import { z } from 'zod';

const TransferSchema = z.object({
  amount:    z.number().positive().max(1_000_000),
  toAccount: z.string().regex(/^[A-Z0-9]{10,20}$/),
});

router.post('/transfer', async (req, res) => {
  const { amount, toAccount } = TransferSchema.parse(req.body);
  await transfer(amount, toAccount);
});`,
      investigationHints: [
        'Find all req.body destructuring in route handlers',
        'Check if zod or Joi is already installed as a dependency',
        'Look for existing schema validation patterns in the codebase to follow',
      ],
      priorityFiles: ['**/routes*', '**/controllers*', '**/api*'],
    },
    CI_SECURITY_FAILURE: {
      issueType: 'CI_SECURITY_FAILURE',
      explanation: 'A security scan (Snyk, CodeQL, SAST) has failed or flagged a high-severity finding in CI.',
      exampleBefore: `// CI: Snyk found 3 high-severity vulnerabilities in dependencies`,
      exampleAfter: `// All security scans pass; no unresolved high-severity findings`,
      investigationHints: [
        'Check the CI run logs for the specific CVE or finding details',
        'Run npm audit locally to see if dependencies have known vulnerabilities',
        'Review Snyk / CodeQL findings in the PR Security tab',
      ],
      priorityFiles: ['**/package.json', '**/*.ts'],
    },
  },
};

const RELIABILITY_PACK: DomainPack = {
  id:   'reliability',
  name: 'Reliability',
  knowledgeSeedDir: join(KNOWLEDGE_DIR, 'reliability'),
  issueTypes: [
    'MISSING_TIMEOUT',
    'NO_CIRCUIT_BREAKER',
    'UNHANDLED_REJECTION',
    'MISSING_RETRY',
    'N_PLUS_ONE_QUERY',
    'CI_RELIABILITY_FAILURE',
  ],
  ciKeywords: ['reliability', 'timeout', 'circuit', 'retry', 'resilience', 'performance'],
  patternRules: [
    {
      id:              'reliability-001',
      issueType:       'MISSING_TIMEOUT',
      description:     'Outbound HTTP call without explicit timeout',
      searchQuery:     '"axios.get" OR "axios.post" OR "fetch(" NOT "timeout"',
      filePathPattern: '\\.(ts|js)$',
      severity:        'HIGH',
      confidenceScore: 0.7,
      watchedFilePaths: ['**/api*', '**/client*', '**/service*', '**/http*'],
    },
    {
      id:              'reliability-002',
      issueType:       'NO_CIRCUIT_BREAKER',
      description:     'External service call without circuit breaker',
      searchQuery:     '"axios" OR "fetch" NOT "CircuitBreaker" NOT "opossum" NOT "Brakes"',
      filePathPattern: '(service|client|external|integration)',
      severity:        'HIGH',
      confidenceScore: 0.6,
      watchedFilePaths: ['**/service*', '**/client*', '**/external*', '**/integration*'],
    },
    {
      id:              'reliability-003',
      issueType:       'UNHANDLED_REJECTION',
      description:     'Promise without await, .catch(), or void — floating promise',
      searchQuery:     '".then(" NOT ".catch(" NOT "await"',
      filePathPattern: '\\.(ts|js)$',
      severity:        'MEDIUM',
      confidenceScore: 0.65,
      watchedFilePaths: ['**/*.ts', '**/*.js'],
    },
    {
      id:              'reliability-004',
      issueType:       'MISSING_RETRY',
      description:     'Transient network call with no retry on 5xx',
      searchQuery:     '"axios.post" OR "fetch(" NOT "retry" NOT "p-retry" NOT "axios-retry"',
      filePathPattern: '(service|client|api)',
      severity:        'MEDIUM',
      confidenceScore: 0.6,
      watchedFilePaths: ['**/service*', '**/client*', '**/api*'],
    },
    {
      id:              'reliability-005',
      issueType:       'N_PLUS_ONE_QUERY',
      description:     'ORM query inside a loop without batching',
      searchQuery:     '"for" AND ("findOne" OR "findById") language:TypeScript',
      filePathPattern: '(service|repository|resolver)',
      severity:        'HIGH',
      confidenceScore: 0.7,
      watchedFilePaths: ['**/service*', '**/repository*', '**/resolver*'],
    },
  ],
  fixStrategies: {
    MISSING_TIMEOUT: {
      issueType: 'MISSING_TIMEOUT',
      explanation: 'HTTP calls without timeouts can hang indefinitely on slow upstreams, blocking threads and exhausting connection pools.',
      exampleBefore: `const resp = await axios.get('https://api.example.com/data');`,
      exampleAfter: `const resp = await axios.get('https://api.example.com/data', {
  timeout: 5_000,  // 5 seconds — fail fast on slow upstream
});`,
      investigationHints: [
        'Find all axios.get / axios.post / fetch calls without timeout configuration',
        'Check if a shared axios instance exists — add timeout there globally',
        'Match the timeout to the upstream service SLA (typically 3–10 seconds)',
      ],
      priorityFiles: ['**/api*', '**/client*', '**/service*'],
    },
    NO_CIRCUIT_BREAKER: {
      issueType: 'NO_CIRCUIT_BREAKER',
      explanation: 'Without a circuit breaker, a failing dependency causes cascading failures across the entire service under load.',
      exampleBefore: `async function getUser(id: string) {
  return axios.get(\`https://user-service/users/\${id}\`);
}`,
      exampleAfter: `import CircuitBreaker from 'opossum';

const breaker = new CircuitBreaker(
  (id: string) => axios.get(\`https://user-service/users/\${id}\`),
  { timeout: 3000, errorThresholdPercentage: 50, resetTimeout: 30000 }
);

async function getUser(id: string) {
  return breaker.fire(id);
}`,
      investigationHints: [
        'Identify calls to external services (payment, notification, user service)',
        'Check if opossum is already in package.json',
        'Look for existing resilience patterns in the codebase',
      ],
      priorityFiles: ['**/service*', '**/client*', '**/external*'],
    },
    UNHANDLED_REJECTION: {
      issueType: 'UNHANDLED_REJECTION',
      explanation: 'Floating promises silently fail — errors are swallowed and the caller never knows the operation failed.',
      exampleBefore: `function sendNotification(userId: string) {
  emailService.send(userId, 'Welcome');  // floating promise
}`,
      exampleAfter: `function sendNotification(userId: string): void {
  void emailService.send(userId, 'Welcome').catch(err => {
    logger.error('Notification failed', { userId, error: err.message });
  });
}`,
      investigationHints: [
        'Find all .then( calls that are missing a corresponding .catch(',
        'Look for async function calls that are not awaited and not assigned',
        'Check for the no-floating-promises ESLint rule — enable it if not already',
      ],
      priorityFiles: ['**/*.ts', '**/*.js'],
    },
    MISSING_RETRY: {
      issueType: 'MISSING_RETRY',
      explanation: 'Transient network errors (5xx, ECONNRESET) succeed on retry. Without retry logic, intermittent failures become user-visible errors.',
      exampleBefore: `const data = await axios.post('https://analytics/events', payload);`,
      exampleAfter: `import pRetry from 'p-retry';

const data = await pRetry(
  () => axios.post('https://analytics/events', payload),
  {
    retries: 3,
    onFailedAttempt: err => logger.warn(\`Attempt \${err.attemptNumber} failed\`),
  }
);`,
      investigationHints: [
        'Identify all outbound network calls to internal and external services',
        'Check if p-retry or axios-retry is already installed',
        'Add shouldRetry check to avoid retrying 4xx (client errors)',
      ],
      priorityFiles: ['**/service*', '**/client*', '**/api*'],
    },
    N_PLUS_ONE_QUERY: {
      issueType: 'N_PLUS_ONE_QUERY',
      explanation: 'Calling a DB query inside a loop causes N queries when 1 batch query would suffice — linear degradation under load.',
      exampleBefore: `for (const order of orders) {
  const user = await User.findById(order.userId);  // N queries!
}`,
      exampleAfter: `const userIds  = orders.map(o => o.userId);
const users    = await User.findAll({ where: { id: userIds } });  // 1 query
const userMap  = new Map(users.map(u => [u.id, u]));

for (const order of orders) {
  const user = userMap.get(order.userId);
}`,
      investigationHints: [
        'Search for findOne / findById / find calls inside for / forEach loops',
        'Check if the ORM supports eager loading or include associations',
        'Consider DataLoader for GraphQL resolvers with batching',
      ],
      priorityFiles: ['**/service*', '**/repository*', '**/resolver*'],
    },
    CI_RELIABILITY_FAILURE: {
      issueType: 'CI_RELIABILITY_FAILURE',
      explanation: 'A reliability-related test or timeout check has failed in CI.',
      exampleBefore: `// CI: timeout tests failed — 2 assertions around missing timeout config`,
      exampleAfter: `// All reliability tests pass`,
      investigationHints: [
        'Check the CI run logs for which test cases failed',
        'Look for tests that check timeout, retry, or circuit breaker configuration',
        'Reproduce locally: npm test -- --grep reliability',
      ],
      priorityFiles: ['**/*.test.ts', '**/service*'],
    },
  },
};

const COMPLIANCE_PACK: DomainPack = {
  id:   'compliance',
  name: 'Compliance',
  knowledgeSeedDir: join(KNOWLEDGE_DIR, 'compliance'),
  issueTypes: [
    'PII_IN_LOGS',
    'UNENCRYPTED_PII',
    'MISSING_AUDIT_LOG',
    'GDPR_RIGHT_TO_DELETE_GAP',
    'MISSING_DATA_RETENTION',
    'CI_COMPLIANCE_FAILURE',
  ],
  ciKeywords: ['compliance', 'gdpr', 'audit', 'pii', 'privacy', 'data-protection'],
  patternRules: [
    {
      id:              'compliance-001',
      issueType:       'PII_IN_LOGS',
      description:     'PII fields (email, phone, ssn) written to logs',
      searchQuery:     '"logger.info" OR "console.log" AND ("email" OR "phone_number" OR "ssn")',
      filePathPattern: '\\.(ts|js)$',
      severity:        'HIGH',
      confidenceScore: 0.75,
      watchedFilePaths: ['**/*.ts', '**/*.js'],
    },
    {
      id:              'compliance-002',
      issueType:       'UNENCRYPTED_PII',
      description:     'Sensitive field stored without encryption transformer',
      searchQuery:     '"@Column" AND ("ssn" OR "dateOfBirth" OR "socialSecurity")',
      filePathPattern: '(schema|model|entity|migration)',
      severity:        'CRITICAL',
      confidenceScore: 0.75,
      watchedFilePaths: ['**/schema*', '**/model*', '**/entity*', '**/migration*'],
    },
    {
      id:              'compliance-003',
      issueType:       'MISSING_AUDIT_LOG',
      description:     'Mutation on sensitive record without audit trail',
      searchQuery:     '"User.update" OR "User.delete" NOT "auditLog" NOT "audit"',
      filePathPattern: '(service|repository|controller)',
      severity:        'HIGH',
      confidenceScore: 0.65,
      watchedFilePaths: ['**/service*', '**/repository*', '**/controller*'],
    },
    {
      id:              'compliance-004',
      issueType:       'GDPR_RIGHT_TO_DELETE_GAP',
      description:     'User entity with no delete or anonymise pathway',
      searchQuery:     '"User" NOT "deleteUser" NOT "anonymiseUser" NOT "hardDelete"',
      filePathPattern: '(user|account|profile|service)',
      severity:        'HIGH',
      confidenceScore: 0.6,
      watchedFilePaths: ['**/user*', '**/account*', '**/profile*', '**/service*'],
    },
    {
      id:              'compliance-005',
      issueType:       'MISSING_DATA_RETENTION',
      description:     'Table with PII and no TTL or cleanup job',
      searchQuery:     '"CREATE TABLE" NOT "expires_at" NOT "TTL" NOT "cleanup"',
      filePathPattern: '(migration|schema|model)',
      severity:        'MEDIUM',
      confidenceScore: 0.55,
      watchedFilePaths: ['**/migration*', '**/schema*', '**/model*'],
    },
  ],
  fixStrategies: {
    PII_IN_LOGS: {
      issueType: 'PII_IN_LOGS',
      explanation: 'Logging PII creates GDPR liability and leaks personal data to log aggregators, monitoring tools, and anyone with log access.',
      exampleBefore: `logger.info('User registered', {
  email: user.email,
  phone: user.phone,
  dob:   user.dateOfBirth,
});`,
      exampleAfter: `logger.info('User registered', {
  userId:    user.id,  // internal identifier — safe
  timestamp: new Date().toISOString(),
});`,
      investigationHints: [
        'Grep for logger.info / console.log with email, phone, ssn, dateOfBirth',
        'Check if a PII scrubber utility already exists in the codebase',
        'Review the logging config for any global field redaction rules',
      ],
      priorityFiles: ['**/*.ts', '**/*.js'],
    },
    UNENCRYPTED_PII: {
      issueType: 'UNENCRYPTED_PII',
      explanation: 'Storing sensitive fields as plaintext means any DB breach directly exposes personal data.',
      exampleBefore: `@Column()
ssn: string;   // stored as plaintext`,
      exampleAfter: `import { encrypt, decrypt } from '../utils/crypto.js';

@Column({ transformer: { to: encrypt, from: decrypt } })
ssn: string;   // encrypted at rest via column transformer`,
      investigationHints: [
        'Find all entity columns storing ssn, dateOfBirth, bankAccount, medicalData',
        'Check if an encryption utility already exists in src/utils/',
        'Use AES-256-GCM for encryption; store IV alongside ciphertext',
      ],
      priorityFiles: ['**/entity*', '**/model*', '**/schema*'],
    },
    MISSING_AUDIT_LOG: {
      issueType: 'MISSING_AUDIT_LOG',
      explanation: 'GDPR and financial regulations require an immutable record of who changed sensitive data and when.',
      exampleBefore: `async function deleteUser(userId: string): Promise<void> {
  await db.user.delete({ where: { id: userId } });
}`,
      exampleAfter: `async function deleteUser(userId: string, actorId: string): Promise<void> {
  await db.auditLog.create({
    data: { action: 'DELETE', entityType: 'User', entityId: userId, actorId, timestamp: new Date() },
  });
  await db.user.delete({ where: { id: userId } });
}`,
      investigationHints: [
        'Find all User.update / User.delete calls that lack an audit log write',
        'Check if an AuditLog model already exists in the schema',
        'Verify the audit log itself is append-only (no update/delete on audit rows)',
      ],
      priorityFiles: ['**/service*', '**/repository*', '**/controller*'],
    },
    GDPR_RIGHT_TO_DELETE_GAP: {
      issueType: 'GDPR_RIGHT_TO_DELETE_GAP',
      explanation: 'GDPR Article 17 requires that users can request erasure. Missing a delete or anonymise pathway makes compliance impossible.',
      exampleBefore: `// No deleteUser or anonymiseUser function exists anywhere in the codebase`,
      exampleAfter: `async function anonymiseUser(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: {
      email:     \`deleted-\${userId}@deleted.invalid\`,
      name:      '[Deleted User]',
      phone:     null,
      deletedAt: new Date(),
    },
  });
  await deleteUserSessions(userId);
}`,
      investigationHints: [
        'Search for a deleteUser or anonymiseUser function — verify it covers all PII fields',
        'Check if cascade deletes cover related tables (orders, addresses, sessions)',
        'Review the data model for all tables that reference the user ID',
      ],
      priorityFiles: ['**/user*', '**/account*', '**/service*'],
    },
    MISSING_DATA_RETENTION: {
      issueType: 'MISSING_DATA_RETENTION',
      explanation: 'Tables with personal data without a TTL or cleanup job accumulate data indefinitely, increasing breach scope and GDPR liability.',
      exampleBefore: `// audit_logs table stores user actions with PII — no cleanup ever runs`,
      exampleAfter: `// Migration: add expires_at to audit_logs
await db.schema.alterTable('audit_logs', t => {
  t.timestamp('expires_at').notNullable();
});

// Nightly cleanup job:
async function cleanExpiredAuditLogs(): Promise<void> {
  await db('audit_logs').where('expires_at', '<', new Date()).delete();
}`,
      investigationHints: [
        'Find tables containing email, phone, or user_id without an expires_at column',
        'Check if a cron job or scheduled task service already exists',
        'Define retention periods by data category (typical: logs 90d, audit 2yr)',
      ],
      priorityFiles: ['**/migration*', '**/schema*', '**/model*', '**/cron*'],
    },
    CI_COMPLIANCE_FAILURE: {
      issueType: 'CI_COMPLIANCE_FAILURE',
      explanation: 'A compliance-related check (PII scan, audit test) failed in CI.',
      exampleBefore: `// CI: FAIL compliance/pii-scan — found unmasked email in logs`,
      exampleAfter: `// All compliance checks pass`,
      investigationHints: [
        'Check CI logs for the specific compliance check that failed',
        'Run the PII scanner locally to reproduce',
        'Review recent changes to logging or data access code',
      ],
      priorityFiles: ['**/*.test.ts', '**/*.ts'],
    },
  },
};

const ALL_PACKS: Record<string, DomainPack> = {
  payments:    PAYMENTS_PACK,
  security:    SECURITY_PACK,
  reliability: RELIABILITY_PACK,
  compliance:  COMPLIANCE_PACK,
};

/**
 * Returns the active domain packs based on config and an optional CLI override.
 * Falls back to payments if no valid domain is found.
 */
export function resolveActivePacks(config: VigilantConfig, domainOverride?: string): DomainPack[] {
  const domains = domainOverride
    ? [domainOverride]
    : (config.domains ?? ['payments']);

  const packs = domains
    .map(d => ALL_PACKS[d])
    .filter((p): p is DomainPack => p !== undefined);

  return packs.length > 0 ? packs : [PAYMENTS_PACK];
}

/** Resolve CI_DOMAIN_FAILURE to a domain-specific CI issue type. */
export function resolveCIIssueType(issueType: string, pack: DomainPack): string {
  if (issueType !== 'CI_DOMAIN_FAILURE') return issueType;
  const ciType = pack.issueTypes.find(t => t.startsWith('CI_'));
  return ciType ?? 'CI_DOMAIN_FAILURE';
}

/**
 * Find the domain pack that owns a given issueType.
 * Used by the agent to pick the right pack when resuming a session.
 */
export function findPackForIssueType(issueType: string): DomainPack | undefined {
  return Object.values(ALL_PACKS).find(p => p.issueTypes.includes(issueType));
}

/**
 * Build a markdown block describing the domain context for the agent system prompt.
 * Includes issue type, explanation, before/after example, and investigation hints.
 */
export function buildDomainPromptBlock(pack: DomainPack, issueType: string): string {
  const strategy = pack.fixStrategies[issueType];
  if (!strategy) {
    return `## Domain: ${pack.name}\nIssue type: ${issueType}\n`;
  }

  return [
    `## Domain: ${pack.name}`,
    `### Issue: ${issueType}`,
    strategy.explanation,
    '',
    '**Bad pattern (before):**',
    '```',
    strategy.exampleBefore,
    '```',
    '',
    '**Fixed pattern (after):**',
    '```',
    strategy.exampleAfter,
    '```',
    '',
    '### Investigation hints',
    ...strategy.investigationHints.map(h => `- ${h}`),
    '',
    `### Priority files to examine`,
    ...strategy.priorityFiles.map(f => `- \`${f}\``),
  ].join('\n');
}
