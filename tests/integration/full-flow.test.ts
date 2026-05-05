// tests/integration/full-flow.test.ts
// Integration test: from DetectedIssue → startAgentSession → AWAITING_APPROVAL
//
// Mocks:
//   - @juspay/neurolink: first generate call returns goalProgress 0.8 (investigation),
//     second call returns a valid JSON Plan (plan generation).
//   - ../src/lib/logger: silenced to keep test output clean.
//
// Uses in-memory SQLite via VIGILANT_STATE_DB_PATH=:memory:

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock NeuroLink before any source import ───────────────────────────────────

const INVESTIGATION_RESPONSE = {
  content: `I found a missing idempotency key in src/payment.ts at line 42.

The payment.create() call on line 42 does not include an idempotency key, which means
duplicate payments can occur on network retries.

\`\`\`json
{
  "goalProgress": 0.82,
  "keyFindings": [
    "src/payment.ts line 42 — payment.create() missing idempotencyKey",
    "No retry guard present in the payment module"
  ]
}
\`\`\``,
};

const PLAN_RESPONSE = {
  content: JSON.stringify({
    summary:                'Add idempotency key to payment.create() call',
    rootCause:              'payment.create() in src/payment.ts called without idempotencyKey option',
    changes: [
      {
        path:        'src/payment.ts',
        description: 'Add idempotency key using a deterministic UUID derived from order ID',
        before:      "payment.create({ amount, currency })",
        after:       "payment.create({ amount, currency, idempotencyKey: `order_${orderId}` })",
      },
    ],
    testSuggestions:        ['test that duplicate calls return the same payment intent'],
    riskLevel:              'LOW',
    estimatedReviewMinutes: 10,
    branchName:             'vigilant/fix-missing-idempotency-key',
  }),
};

vi.mock('@juspay/neurolink', () => {
  class MockNeuroLink {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async generate(options: Record<string, any>) {
      // Plan generator sets disableTools: true — return the plan JSON
      if (options.disableTools === true) {
        return PLAN_RESPONSE;
      }
      // Investigation loop calls — return high-confidence progress
      return INVESTIGATION_RESPONSE;
    }
  }
  return { NeuroLink: MockNeuroLink };
});

// Silence logger output during tests
vi.mock('../../src/lib/logger.js', () => ({
  info:  vi.fn(),
  warn:  vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import { resetDbForTesting } from '../../src/db/index.js';
import { getSession }        from '../../src/db/queries/sessions.js';
import { startAgentSession } from '../../src/agent/index.js';
import type { DetectedIssue } from '../../src/agent/types.js';
import type { VigilantConfig } from '../../src/config/types.js';

const CONFIG: VigilantConfig = {
  githubToken:          'gh_test_token',
  geminiApiKey:         'gm_test_key',
  defaultRepos:         [],
  watchIntervalSeconds: 60,
  domains:              ['payments'],
  maxIterations:        5,
  autoMerge:            false,
};

const DETECTED_ISSUE: DetectedIssue = {
  repoOwner:  'acme',
  repoName:   'api',
  domain:     'payments',
  issueType:  'MISSING_IDEMPOTENCY_KEY',
  severity:   'HIGH',
  confidence: 0.75,
  sourceRef:  'pr/42',
  evidence:   ['payment.create() call in src/payment.ts at line 42 — no idempotency key'],
  foundBy:    'pr_scanner',
};

beforeEach(() => {
  process.env['VIGILANT_STATE_DB_PATH'] = ':memory:';
  resetDbForTesting();
});

afterEach(() => {
  resetDbForTesting();
  delete process.env['VIGILANT_STATE_DB_PATH'];
  vi.clearAllMocks();
});

describe('Full flow: DetectedIssue → startAgentSession → AWAITING_APPROVAL', () => {
  it('creates a session and advances to AWAITING_APPROVAL stage', async () => {
    const { resolveActivePacks } = await import('../../src/agent/domain-context.js');
    const activePacks = resolveActivePacks(CONFIG);

    const session = await startAgentSession(DETECTED_ISSUE, activePacks, CONFIG);

    expect(session).not.toBeNull();
    expect(session!.stage).toBe('awaiting_approval');
  }, 15_000);

  it('persists the session in the database', async () => {
    const { resolveActivePacks } = await import('../../src/agent/domain-context.js');
    const activePacks = resolveActivePacks(CONFIG);

    const session = await startAgentSession(DETECTED_ISSUE, activePacks, CONFIG);
    expect(session).not.toBeNull();

    const persisted = getSession(session!.sessionId);
    expect(persisted).not.toBeNull();
    expect(persisted!.sessionId).toBe(session!.sessionId);
    expect(persisted!.stage).toBe('awaiting_approval');
  }, 15_000);

  it('generates a plan and stores it on the session', async () => {
    const { resolveActivePacks } = await import('../../src/agent/domain-context.js');
    const activePacks = resolveActivePacks(CONFIG);

    const session = await startAgentSession(DETECTED_ISSUE, activePacks, CONFIG);
    expect(session).not.toBeNull();

    const persisted = getSession(session!.sessionId);
    expect(persisted!.plan).not.toBeNull();
    expect(persisted!.plan!.summary).toBeTruthy();
    expect(persisted!.plan!.changes.length).toBeGreaterThanOrEqual(0);
  }, 15_000);

  it('records goalProgress > 0 from the investigation', async () => {
    const { resolveActivePacks } = await import('../../src/agent/domain-context.js');
    const activePacks = resolveActivePacks(CONFIG);

    const session = await startAgentSession(DETECTED_ISSUE, activePacks, CONFIG);
    expect(session).not.toBeNull();

    const persisted = getSession(session!.sessionId);
    expect(persisted!.goalProgress).toBeGreaterThan(0);
  }, 15_000);

  it('stores initial evidence on the session', async () => {
    const { resolveActivePacks } = await import('../../src/agent/domain-context.js');
    const activePacks = resolveActivePacks(CONFIG);

    const session = await startAgentSession(DETECTED_ISSUE, activePacks, CONFIG);
    expect(session).not.toBeNull();

    const persisted = getSession(session!.sessionId);
    expect(persisted!.evidence).toContain(DETECTED_ISSUE.evidence[0]);
  }, 15_000);

  it('assigns correct repoOwner and repoName', async () => {
    const { resolveActivePacks } = await import('../../src/agent/domain-context.js');
    const activePacks = resolveActivePacks(CONFIG);

    const session = await startAgentSession(DETECTED_ISSUE, activePacks, CONFIG);
    expect(session).not.toBeNull();

    expect(session!.repoOwner).toBe('acme');
    expect(session!.repoName).toBe('api');
  }, 15_000);
});
