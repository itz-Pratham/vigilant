// tests/integration/mcp-server.test.ts
// Integration tests for the MCP server end-to-end:
// createMCPServer() → tool registration → tool call → structured result.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Client }               from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport }    from '@modelcontextprotocol/sdk/inMemory.js';

// ── Module mocks ──────────────────────────────────────────────────────────────

// Mock DB so no real file is touched
let _mockRows: Record<string, unknown>[] = [];

vi.mock('../../src/db/index.js', () => ({
  getStateDb: () => ({
    prepare: (_sql: string) => ({
      all: (..._params: unknown[]) => _mockRows,
    }),
  }),
  getKnowledgeDb:   vi.fn(),
  resetDbForTesting: vi.fn(),
}));

// Mock sessions DB
vi.mock('../../src/db/queries/sessions.js', () => ({
  getSession:          vi.fn().mockReturnValue(null),
  saveSession:         vi.fn(),
  listSessions:        vi.fn().mockReturnValue([]),
  countActiveSessions: vi.fn().mockReturnValue({ count: 0 }),
  getMaxRunNumber:     vi.fn().mockReturnValue({ maxRun: null }),
}));

// Mock config + domain context (for analyze_snippet and get_domain_pattern)
vi.mock('../../src/config/index.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({ domains: ['payments'], githubToken: 'test-tok' }),
}));

vi.mock('../../src/agent/domain-context.js', () => ({
  resolveActivePacks: vi.fn().mockReturnValue([{
    id:          'payments',
    issueTypes:  ['MISSING_IDEMPOTENCY'],
    patternRules: [{
      id:              'r1',
      issueType:       'MISSING_IDEMPOTENCY',
      severity:        'HIGH',
      description:     'No idempotency key.',
      searchQuery:     '"createPayment"',
      filePathPattern: '**/*',
      confidenceScore: 0.9,
      watchedFilePaths: [],
    }],
    fixStrategies: {
      MISSING_IDEMPOTENCY: {
        issueType:          'MISSING_IDEMPOTENCY',
        explanation:        'Add idempotency key.',
        exampleBefore:      'stripe.charge({ amount: 1000 })',
        exampleAfter:       'stripe.charge({ amount: 1000, idempotencyKey: uuid() })',
        investigationHints: ['Check all payment creation calls'],
        priorityFiles:      [],
      },
    },
  }]),
  findPackForIssueType: vi.fn((type: string) => {
    if (type === 'MISSING_IDEMPOTENCY') {
      return {
        id:          'payments',
        issueTypes:  ['MISSING_IDEMPOTENCY'],
        patternRules: [{ id: 'r1', issueType: 'MISSING_IDEMPOTENCY', severity: 'HIGH', description: 'No idempotency key.', searchQuery: '"createPayment"', filePathPattern: '**/*', confidenceScore: 0.9, watchedFilePaths: [] }],
        fixStrategies: {
          MISSING_IDEMPOTENCY: {
            issueType: 'MISSING_IDEMPOTENCY', explanation: 'Add idempotency key.',
            exampleBefore: 'stripe.charge({ amount: 1000 })',
            exampleAfter: 'stripe.charge({ amount: 1000, idempotencyKey: uuid() })',
            investigationHints: [], priorityFiles: [],
          },
        },
      };
    }
    return undefined;
  }),
}));

// Mock NeuroLink (for analyze_snippet)
vi.mock('@juspay/neurolink', () => ({
  NeuroLink: class {
    async generate(_opts: unknown) {
      return {
        content: JSON.stringify({
          issueType:   'MISSING_IDEMPOTENCY',
          severity:    'HIGH',
          confidence:  0.9,
          explanation: 'Payment missing idempotency key.',
          suggestion:  'Add idempotencyKey field.',
        }),
      };
    }
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Creates a connected MCP client/server pair using the in-memory transport.
 * Returns the client ready to call tools.
 */
async function makeClient() {
  const { createMCPServer } = await import('../../src/mcp/index.js');
  const { NeuroLink }       = await import('@juspay/neurolink');
  const neurolink           = new NeuroLink();
  const server              = createMCPServer(neurolink);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return client;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MCP server integration', () => {
  beforeEach(() => {
    _mockRows = [];
    vi.clearAllMocks();
  });

  describe('server initialization', () => {
    it('registers 5 tools', async () => {
      const client = await makeClient();
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(5);
      const names = tools.map(t => t.name);
      expect(names).toContain('list_known_issues');
      expect(names).toContain('analyze_snippet');
      expect(names).toContain('get_domain_pattern');
      expect(names).toContain('get_session_status');
      expect(names).toContain('approve_plan');
    });
  });

  describe('list_known_issues', () => {
    it('returns "no active sessions" message when DB is empty', async () => {
      _mockRows = [];
      const client = await makeClient();
      const result = await client.callTool({ name: 'list_known_issues', arguments: { limit: 10 } });
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('No active vigilant sessions');
    });

    it('returns session list when DB has rows', async () => {
      _mockRows = [{
        session_id:    'sess-001',
        domain:        'payments',
        issue_type:    'MISSING_IDEMPOTENCY',
        severity:      'HIGH',
        stage:         'investigating',
        repo:          'acme/payments-api',
        created_at:    new Date().toISOString(),
        pr_url:        null,
        blocker_reason: null,
      }];
      const client = await makeClient();
      const result = await client.callTool({ name: 'list_known_issues', arguments: { limit: 10 } });
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('sess-001');
      expect(text).toContain('MISSING_IDEMPOTENCY');
    });
  });

  describe('get_session_status', () => {
    it('returns not-found for unknown session ID', async () => {
      const { getSession } = await import('../../src/db/queries/sessions.js');
      vi.mocked(getSession).mockReturnValue(null);

      const client = await makeClient();
      const result = await client.callTool({
        name:      'get_session_status',
        arguments: { sessionId: 'nonexistent' },
      });
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('not found');
    });

    it('returns session details for a known session', async () => {
      const { getSession } = await import('../../src/db/queries/sessions.js');
      vi.mocked(getSession).mockReturnValue({
        sessionId:       'sess-integration',
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
      } as never);

      const client = await makeClient();
      const result = await client.callTool({
        name:      'get_session_status',
        arguments: { sessionId: 'sess-integration' },
      });
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('sess-integration');
      expect(text).toContain('MISSING_IDEMPOTENCY');
    });
  });

  describe('get_domain_pattern', () => {
    it('returns full pattern info for a known issue type', async () => {
      const client = await makeClient();
      const result = await client.callTool({
        name:      'get_domain_pattern',
        arguments: { issueType: 'MISSING_IDEMPOTENCY' },
      });
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('MISSING_IDEMPOTENCY');
      expect(text).toContain('stripe.charge');
    });

    it('lists available types for unknown issue type', async () => {
      const client = await makeClient();
      const result = await client.callTool({
        name:      'get_domain_pattern',
        arguments: { issueType: 'UNKNOWN_TYPE' },
      });
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('Unknown issue type');
    });
  });

  describe('analyze_snippet', () => {
    it('returns analysis for a code snippet', async () => {
      const client = await makeClient();
      const result = await client.callTool({
        name:      'analyze_snippet',
        arguments: { code: 'async function createPayment() {}', language: 'typescript' },
      });
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('MISSING_IDEMPOTENCY');
    });
  });

  describe('approve_plan', () => {
    it('returns error for unknown session', async () => {
      const { getSession } = await import('../../src/db/queries/sessions.js');
      vi.mocked(getSession).mockReturnValue(null);

      const client = await makeClient();
      const result = await client.callTool({
        name:      'approve_plan',
        arguments: { sessionId: 'nonexistent' },
      });
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('not found');
    });
  });
});
