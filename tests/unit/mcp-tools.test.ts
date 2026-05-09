// tests/unit/mcp-tools.test.ts
// Unit tests for all 5 MCP tool handlers.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// ── Shared hoisted data (available inside vi.mock factories) ──────────────────

const { MOCK_PACK } = vi.hoisted(() => {
  const MOCK_PACK = {
    id:         'payments',
    issueTypes: ['MISSING_IDEMPOTENCY'],
    patternRules: [{
      id:              'r1',
      issueType:       'MISSING_IDEMPOTENCY',
      severity:        'HIGH',
      description:     'Payment calls lack idempotency keys.',
      searchQuery:     '"createPayment" NOT "idempotencyKey"',
      filePathPattern: '**/*',
      confidenceScore: 0.9,
      watchedFilePaths: [] as string[],
    }],
    fixStrategies: {
      MISSING_IDEMPOTENCY: {
        issueType:          'MISSING_IDEMPOTENCY',
        explanation:        'Add idempotency key to all payment requests.',
        exampleBefore:      'stripe.charge({ amount: 1000 })',
        exampleAfter:       'stripe.charge({ amount: 1000, idempotencyKey: uuid() })',
        investigationHints: ['Check all payment creation calls'],
        priorityFiles:      [] as string[],
      },
    },
  };
  return { MOCK_PACK };
});

// ── Top-level vi.mock calls ───────────────────────────────────────────────────

let _db: Database.Database | null = null;

vi.mock('../../src/db/index.js', () => ({
  getStateDb:        () => _db,
  getKnowledgeDb:    vi.fn(),
  resetDbForTesting: vi.fn(),
}));

vi.mock('../../src/db/queries/sessions.js', () => ({
  getSession:          vi.fn(),
  saveSession:         vi.fn(),
  listSessions:        vi.fn().mockReturnValue([]),
  countActiveSessions: vi.fn().mockReturnValue({ count: 0 }),
  getMaxRunNumber:     vi.fn().mockReturnValue({ maxRun: null }),
}));

vi.mock('../../src/config/index.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({ domains: ['payments'], githubToken: 'tok' }),
}));

vi.mock('../../src/agent/domain-context.js', () => ({
  findPackForIssueType: vi.fn((type: string) => {
    if (type === 'MISSING_IDEMPOTENCY') return MOCK_PACK;
    return undefined;
  }),
  resolveActivePacks: vi.fn().mockReturnValue([MOCK_PACK]),
}));

// ── DB helpers ────────────────────────────────────────────────────────────────

function makeSessionDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      session_id     TEXT PRIMARY KEY,
      repo_owner     TEXT NOT NULL,
      repo_name      TEXT NOT NULL,
      domain         TEXT NOT NULL DEFAULT 'payments',
      issue_type     TEXT NOT NULL,
      severity       TEXT NOT NULL DEFAULT 'HIGH',
      stage          TEXT NOT NULL DEFAULT 'discovered',
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      pr_url         TEXT,
      blocker_reason TEXT
    )
  `);
  return db;
}

function insertSession(db: Database.Database, overrides: Record<string, unknown> = {}): void {
  const defaults = {
    session_id: 'sess-001',
    repo_owner: 'acme',
    repo_name:  'payments-api',
    domain:     'payments',
    issue_type: 'MISSING_IDEMPOTENCY',
    severity:   'HIGH',
    stage:      'discovered',
    created_at: new Date().toISOString(),
  };
  const row = { ...defaults, ...overrides };
  db.prepare(`
    INSERT OR REPLACE INTO agent_sessions
      (session_id, repo_owner, repo_name, domain, issue_type, severity, stage, created_at)
    VALUES
      (@session_id, @repo_owner, @repo_name, @domain, @issue_type, @severity, @stage, @created_at)
  `).run(row);
}

// ─── 1. listKnownIssues ───────────────────────────────────────────────────────

describe('handleListKnownIssues', () => {
  beforeEach(() => {
    _db = makeSessionDb();
  });

  it('returns "no sessions" message when table is empty', async () => {
    const { handleListKnownIssues } = await import('../../src/mcp/tools/listKnownIssues.js');
    const result = handleListKnownIssues({ limit: 10 });
    expect(result.content[0]?.text).toContain('No active vigilant sessions');
  });

  it('returns active sessions excluding terminal stages by default', async () => {
    insertSession(_db!, { session_id: 'sess-active', stage: 'investigating' });
    insertSession(_db!, { session_id: 'sess-merged', stage: 'merged' });

    const { handleListKnownIssues } = await import('../../src/mcp/tools/listKnownIssues.js');
    const result = handleListKnownIssues({ limit: 10 });
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('sess-active');
    expect(text).not.toContain('sess-merged');
  });

  it('filters by status when status is specified', async () => {
    insertSession(_db!, { session_id: 'sess-inv',      stage: 'investigating' });
    insertSession(_db!, { session_id: 'sess-planning', stage: 'planning' });

    const { handleListKnownIssues } = await import('../../src/mcp/tools/listKnownIssues.js');
    const result = handleListKnownIssues({ limit: 10, status: 'planning' });
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('sess-planning');
    expect(text).not.toContain('sess-inv');
  });

  it('filters by domain when domain is specified', async () => {
    insertSession(_db!, { session_id: 'sess-pay', domain: 'payments', stage: 'investigating' });
    insertSession(_db!, { session_id: 'sess-sec', domain: 'security', stage: 'investigating' });

    const { handleListKnownIssues } = await import('../../src/mcp/tools/listKnownIssues.js');
    const result = handleListKnownIssues({ limit: 10, domain: 'payments' });
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('sess-pay');
    expect(text).not.toContain('sess-sec');
  });

  it('respects the limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      insertSession(_db!, { session_id: `sess-${i}`, stage: 'investigating' });
    }

    const { handleListKnownIssues } = await import('../../src/mcp/tools/listKnownIssues.js');
    const result = handleListKnownIssues({ limit: 2 });
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Found 2');
  });

  it('returns result with content array of type text', async () => {
    insertSession(_db!, { session_id: 'sess-type-check', stage: 'investigating' });
    const { handleListKnownIssues } = await import('../../src/mcp/tools/listKnownIssues.js');
    const result = handleListKnownIssues({ limit: 10 });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');
  });
});

// ─── 2. analyzeSnippet ────────────────────────────────────────────────────────

describe('handleAnalyzeSnippet', () => {
  it('returns issue text when NeuroLink identifies a problem', async () => {
    const neurolink = {
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          issueType:   'MISSING_IDEMPOTENCY',
          severity:    'HIGH',
          confidence:  0.9,
          explanation: 'The payment is missing an idempotency key.',
          suggestion:  'Add an idempotency key to the request.',
        }),
      }),
    };

    const { handleAnalyzeSnippet } = await import('../../src/mcp/tools/analyzeSnippet.js');
    const result = await handleAnalyzeSnippet(neurolink as never, {
      code:     'async function createPayment() {}',
      language: 'typescript',
    });
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('MISSING_IDEMPOTENCY');
    expect(text).toContain('HIGH');
  });

  it('strips code fences from NeuroLink JSON response', async () => {
    const neurolink = {
      generate: vi.fn().mockResolvedValue({
        content: '```json\n{"issueType":null,"severity":null,"confidence":0.1,"explanation":"Looks fine","suggestion":null}\n```',
      }),
    };

    const { handleAnalyzeSnippet } = await import('../../src/mcp/tools/analyzeSnippet.js');
    const result = await handleAnalyzeSnippet(neurolink as never, {
      code:     'const x = 1;',
      language: 'typescript',
    });
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Looks fine');
    expect(text).not.toContain('```json');
  });

  it('returns fallback when NeuroLink throws', async () => {
    const neurolink = {
      generate: vi.fn().mockRejectedValue(new Error('API error')),
    };

    const { handleAnalyzeSnippet } = await import('../../src/mcp/tools/analyzeSnippet.js');
    const result = await handleAnalyzeSnippet(neurolink as never, {
      code:     'const x = 1;',
      language: 'typescript',
    });
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Analysis failed');
  });

  it('returns "no issues" message when confidence is below threshold', async () => {
    const neurolink = {
      generate: vi.fn().mockResolvedValue({
        content: '{"issueType":"MISSING_IDEMPOTENCY","severity":"HIGH","confidence":0.1,"explanation":"Very unlikely","suggestion":null}',
      }),
    };

    const { handleAnalyzeSnippet } = await import('../../src/mcp/tools/analyzeSnippet.js');
    const result = await handleAnalyzeSnippet(neurolink as never, {
      code:     'const x = 1;',
      language: 'typescript',
    });
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('No significant issues');
  });
});

// ─── 3. getDomainPattern ──────────────────────────────────────────────────────

describe('handleGetDomainPattern', () => {
  it('returns full pattern info for a known issue type', async () => {
    const { handleGetDomainPattern } = await import('../../src/mcp/tools/getDomainPattern.js');
    const result = await handleGetDomainPattern({ issueType: 'MISSING_IDEMPOTENCY' });
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('MISSING_IDEMPOTENCY');
    expect(text).toContain('stripe.charge');
    expect(text).toContain('idempotencyKey');
  });

  it('normalizes issueType to uppercase', async () => {
    const { handleGetDomainPattern } = await import('../../src/mcp/tools/getDomainPattern.js');
    const result = await handleGetDomainPattern({ issueType: 'missing_idempotency' });
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('MISSING_IDEMPOTENCY');
  });

  it('lists available types when issueType is unknown', async () => {
    const { handleGetDomainPattern } = await import('../../src/mcp/tools/getDomainPattern.js');
    const result = await handleGetDomainPattern({ issueType: 'NONEXISTENT_ISSUE' });
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Unknown issue type');
    expect(text).toContain('Available issue types');
  });
});

// ─── 4. getSessionStatus ──────────────────────────────────────────────────────

describe('handleGetSessionStatus', () => {
  const makeSession = (overrides: Record<string, unknown> = {}) => ({
    sessionId:       'sess-abc',
    repoOwner:       'acme',
    repoName:        'payments-api',
    domain:          'payments',
    issueType:       'MISSING_IDEMPOTENCY',
    stage:           'investigating',
    severity:        'HIGH',
    confidence:      0.9,
    sourceRef:       '',
    evidence:        [],
    iterationCount:  1,
    goalProgress:    0.5,
    keyFindings:     [],
    dataCollected:   {},
    plan:            null,
    branchName:      null,
    prNumber:        null,
    prUrl:           null,
    prHeadSha:       null,
    ciStatus:        null,
    executorStep:    null,
    selfReviewCount: 0,
    blockerReason:   null,
    stallCount:      0,
    runNumber:       1,
    createdAt:       new Date().toISOString(),
    updatedAt:       new Date().toISOString(),
    ...overrides,
  });

  it('returns "not found" for unknown session ID', async () => {
    const { getSession } = await import('../../src/db/queries/sessions.js');
    vi.mocked(getSession).mockReturnValue(null);

    const { handleGetSessionStatus } = await import('../../src/mcp/tools/getSessionStatus.js');
    const result = handleGetSessionStatus({ sessionId: 'unknown-id' });
    expect(result.content[0]?.text).toContain('not found');
  });

  it('renders session table for a known session', async () => {
    const { getSession } = await import('../../src/db/queries/sessions.js');
    vi.mocked(getSession).mockReturnValue(makeSession() as never);

    const { handleGetSessionStatus } = await import('../../src/mcp/tools/getSessionStatus.js');
    const result = handleGetSessionStatus({ sessionId: 'sess-abc' });
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('sess-abc');
    expect(text).toContain('MISSING_IDEMPOTENCY');
    expect(text).toContain('acme/payments-api');
    expect(text).toContain('investigating');
  });

  it('includes plan details when plan is present', async () => {
    const { getSession } = await import('../../src/db/queries/sessions.js');
    vi.mocked(getSession).mockReturnValue(makeSession({
      plan: {
        summary:   'Add idempotency keys.',
        rootCause: 'No idempotency key in createPayment.',
        changes:   [{ path: 'src/payments.ts', description: 'Add idempotencyKey param', type: 'modify' }],
        testSuggestions: ['Test with duplicate requests'],
      },
    }) as never);

    const { handleGetSessionStatus } = await import('../../src/mcp/tools/getSessionStatus.js');
    const result = handleGetSessionStatus({ sessionId: 'sess-abc' });
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Add idempotency keys');
    expect(text).toContain('src/payments.ts');
  });

  it('shows approval call-to-action when stage is awaiting_approval', async () => {
    const { getSession } = await import('../../src/db/queries/sessions.js');
    vi.mocked(getSession).mockReturnValue(makeSession({ stage: 'awaiting_approval' }) as never);

    const { handleGetSessionStatus } = await import('../../src/mcp/tools/getSessionStatus.js');
    const result = handleGetSessionStatus({ sessionId: 'sess-abc' });
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('approve_plan');
  });
});

// ─── 5. approvePlan ───────────────────────────────────────────────────────────

describe('handleApprovePlan', () => {
  /** Always returns a fresh copy — prevents mutation across tests */
  const makeApprovalSession = (overrides: Record<string, unknown> = {}) => ({
    sessionId:       'sess-approve',
    repoOwner:       'acme',
    repoName:        'payments-api',
    domain:          'payments',
    issueType:       'MISSING_IDEMPOTENCY',
    stage:           'awaiting_approval',
    severity:        'HIGH',
    confidence:      0.9,
    sourceRef:       '',
    evidence:        [],
    iterationCount:  2,
    goalProgress:    0.8,
    keyFindings:     [],
    dataCollected:   {},
    plan: {
      summary:   'Add idempotency keys to createPayment.',
      rootCause: 'Missing idempotency key.',
      changes:   [{ path: 'src/payments.ts', description: 'Add idempotencyKey', type: 'modify' }],
      testSuggestions: [],
    },
    branchName:      'vigilant/fix-missing-idempotency',
    prNumber:        null,
    prUrl:           null,
    prHeadSha:       null,
    ciStatus:        null,
    executorStep:    null,
    selfReviewCount: 0,
    blockerReason:   null,
    stallCount:      0,
    runNumber:       1,
    createdAt:       new Date().toISOString(),
    updatedAt:       new Date().toISOString(),
    ...overrides,
  });

  it('returns not-found for unknown session ID', async () => {
    const { getSession } = await import('../../src/db/queries/sessions.js');
    vi.mocked(getSession).mockReturnValue(null);

    const { handleApprovePlan } = await import('../../src/mcp/tools/approvePlan.js');
    const result = handleApprovePlan({ sessionId: 'nonexistent' });
    expect(result.content[0]?.text).toContain('not found');
  });

  it('approves a session in awaiting_approval stage', async () => {
    const { getSession, saveSession } = await import('../../src/db/queries/sessions.js');
    vi.mocked(getSession).mockReturnValue(makeApprovalSession() as never);
    vi.mocked(saveSession).mockReturnValue(undefined);

    const { handleApprovePlan } = await import('../../src/mcp/tools/approvePlan.js');
    const result = handleApprovePlan({ sessionId: 'sess-approve' });
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('approved');
    expect(saveSession).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'executing' }),
    );
  });

  it('returns error when session is not in awaiting_approval', async () => {
    const { getSession } = await import('../../src/db/queries/sessions.js');
    vi.mocked(getSession).mockReturnValue(makeApprovalSession({ stage: 'investigating' }) as never);

    const { handleApprovePlan } = await import('../../src/mcp/tools/approvePlan.js');
    const result = handleApprovePlan({ sessionId: 'sess-approve' });
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Cannot approve');
  });

  it('returns Gate 2 message when stage is awaiting_merge', async () => {
    const { getSession } = await import('../../src/db/queries/sessions.js');
    vi.mocked(getSession).mockReturnValue(makeApprovalSession({ stage: 'awaiting_merge' }) as never);

    const { handleApprovePlan } = await import('../../src/mcp/tools/approvePlan.js');
    const result = handleApprovePlan({ sessionId: 'sess-approve' });
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Gate 2');
  });

  it('returns error when session has no plan', async () => {
    const { getSession } = await import('../../src/db/queries/sessions.js');
    // stage must stay awaiting_approval, only plan is null
    vi.mocked(getSession).mockReturnValue(makeApprovalSession({ plan: null }) as never);

    const { handleApprovePlan } = await import('../../src/mcp/tools/approvePlan.js');
    const result = handleApprovePlan({ sessionId: 'sess-approve' });
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('no plan');
  });
});
