// src/agent/domain-context.ts
// Domain pack definitions and active pack resolver.
// Full pack loading (from knowledge/ seeds) is implemented in Phase 8.

import type { PatternRule } from '../watcher/types.js';
import type { VigilantConfig } from '../config/types.js';

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
};

// ── Built-in domain packs ─────────────────────────────────────────────────────

const PAYMENTS_PACK: DomainPack = {
  id:   'payments',
  name: 'Payments',
  issueTypes: [
    'MISSING_IDEMPOTENCY_KEY',
    'UNVERIFIED_WEBHOOK',
    'SILENT_PAYMENT_ERROR',
    'RETRYING_TERMINAL_ERROR',
    'SDK_VERSION_DRIFT',
    'CI_PAYMENT_FAILURE',
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
  ],
};

const SECURITY_PACK: DomainPack = {
  id:   'security',
  name: 'Security',
  issueTypes: ['SECRET_IN_CODE', 'SQL_INJECTION_RISK', 'MISSING_AUTH_CHECK', 'PII_IN_LOGS', 'CI_SECURITY_FAILURE'],
  ciKeywords: ['security', 'auth', 'vulnerability', 'scan', 'sast'],
  patternRules: [
    {
      id:              'security-001',
      issueType:       'SECRET_IN_CODE',
      description:     'Hardcoded secret or API key in source',
      searchQuery:     '"api_key" OR "apiKey" OR "secret" OR "password" NOT "process.env" NOT "os.environ"',
      filePathPattern: '\\.(ts|js|py|go|java)$',
      severity:        'CRITICAL',
      confidenceScore: 0.85,
      watchedFilePaths: ['**/*.ts', '**/*.js', '**/*.py'],
    },
    {
      id:              'security-002',
      issueType:       'MISSING_AUTH_CHECK',
      description:     'Route handler without authentication middleware',
      searchQuery:     '"router.post" OR "app.post" NOT "authenticate" NOT "authorize" NOT "requireAuth"',
      filePathPattern: '(routes|controllers|api)',
      severity:        'HIGH',
      confidenceScore: 0.7,
      watchedFilePaths: ['**/routes*', '**/controllers*', '**/api*'],
    },
  ],
};

const RELIABILITY_PACK: DomainPack = {
  id:   'reliability',
  name: 'Reliability',
  issueTypes: ['MISSING_TIMEOUT', 'NO_CIRCUIT_BREAKER', 'UNHANDLED_REJECTION', 'MISSING_RETRY', 'CI_RELIABILITY_FAILURE'],
  ciKeywords: ['reliability', 'timeout', 'circuit', 'retry', 'resilience'],
  patternRules: [
    {
      id:              'reliability-001',
      issueType:       'MISSING_TIMEOUT',
      description:     'HTTP client call without explicit timeout',
      searchQuery:     '"axios.get" OR "fetch(" OR "http.request" NOT "timeout"',
      filePathPattern: '\\.(ts|js)$',
      severity:        'MEDIUM',
      confidenceScore: 0.7,
      watchedFilePaths: ['**/api*', '**/client*', '**/service*'],
    },
  ],
};

const COMPLIANCE_PACK: DomainPack = {
  id:   'compliance',
  name: 'Compliance',
  issueTypes: ['PII_IN_LOGS', 'UNENCRYPTED_PII', 'MISSING_AUDIT_LOG', 'CI_COMPLIANCE_FAILURE'],
  ciKeywords: ['compliance', 'gdpr', 'audit', 'pii'],
  patternRules: [
    {
      id:              'compliance-001',
      issueType:       'PII_IN_LOGS',
      description:     'PII fields (email, phone, ssn) written to logs',
      searchQuery:     '"logger.info" OR "console.log" AND ("email" OR "phone_number" OR "ssn")',
      severity:        'HIGH',
      confidenceScore: 0.75,
      watchedFilePaths: ['**/*.ts', '**/*.js'],
    },
  ],
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
