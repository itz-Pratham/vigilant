// tests/unit/db-sessions.test.ts
// Unit tests for src/db/queries/sessions.ts using in-memory SQLite.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDbForTesting } from '../../src/db/index.js';
import {
  createSession,
  getSession,
  saveSession,
  listSessions,
  listAllSessions,
  listSessionsByStage,
  activeSessionExists,
  getNextRunNumber,
} from '../../src/db/queries/sessions.js';
import type { IssueSession } from '../../src/agent/types.js';

function makeSession(overrides: Partial<IssueSession> = {}): IssueSession {
  const now = new Date().toISOString();
  return {
    sessionId:       overrides.sessionId ?? `SESS_${Math.random().toString(36).slice(2)}`,
    repoOwner:       'acme',
    repoName:        'api',
    domain:          'payments',
    issueType:       'MISSING_IDEMPOTENCY_KEY',
    stage:           'discovered',
    severity:        'HIGH',
    confidence:      0.5,
    sourceRef:       'abc123',
    evidence:        ['some evidence'],
    iterationCount:  0,
    goalProgress:    0.0,
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
    createdAt:       now,
    updatedAt:       now,
    ...overrides,
  };
}

beforeEach(() => {
  process.env['VIGILANT_STATE_DB_PATH'] = ':memory:';
  resetDbForTesting();
});

afterEach(() => {
  resetDbForTesting();
  delete process.env['VIGILANT_STATE_DB_PATH'];
});

describe('createSession / getSession', () => {
  it('round-trips a session through the DB', () => {
    const s = makeSession({ sessionId: 'SESS_001' });
    createSession(s);
    const fetched = getSession('SESS_001');
    expect(fetched).not.toBeNull();
    expect(fetched!.sessionId).toBe('SESS_001');
    expect(fetched!.repoOwner).toBe('acme');
    expect(fetched!.severity).toBe('HIGH');
  });

  it('deserialises evidence array correctly', () => {
    const s = makeSession({ evidence: ['finding a', 'finding b'] });
    createSession(s);
    const fetched = getSession(s.sessionId)!;
    expect(fetched.evidence).toEqual(['finding a', 'finding b']);
  });

  it('returns null for unknown sessionId', () => {
    expect(getSession('SESS_nonexistent')).toBeNull();
  });
});

describe('saveSession', () => {
  it('updates fields in the DB', () => {
    const s = makeSession({ sessionId: 'SESS_002' });
    createSession(s);
    saveSession({ ...s, stage: 'investigating', goalProgress: 0.4 });
    const updated = getSession('SESS_002')!;
    expect(updated.stage).toBe('investigating');
    expect(updated.goalProgress).toBeCloseTo(0.4);
  });

  it('persists keyFindings array', () => {
    const s = makeSession({ sessionId: 'SESS_003' });
    createSession(s);
    saveSession({ ...s, keyFindings: ['finding X', 'finding Y'] });
    const updated = getSession('SESS_003')!;
    expect(updated.keyFindings).toEqual(['finding X', 'finding Y']);
  });

  it('persists a plan object', () => {
    const s = makeSession({ sessionId: 'SESS_004' });
    createSession(s);
    const plan = {
      summary: 'Add idempotency key',
      rootCause: 'Missing key in payment call',
      changes: [],
      testSuggestions: [],
      riskLevel: 'LOW' as const,
      estimatedReviewMinutes: 5,
      branchName: 'vigilant/fix-idempotency',
    };
    saveSession({ ...s, plan });
    const updated = getSession('SESS_004')!;
    expect(updated.plan).not.toBeNull();
    expect(updated.plan!.summary).toBe('Add idempotency key');
  });
});

describe('listSessions', () => {
  it('returns sessions for correct repo only', () => {
    const s1 = makeSession({ sessionId: 'SESS_A', repoOwner: 'acme', repoName: 'api' });
    const s2 = makeSession({ sessionId: 'SESS_B', repoOwner: 'other', repoName: 'repo' });
    createSession(s1);
    createSession(s2);
    const sessions = listSessions('acme', 'api');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('SESS_A');
  });
});

describe('listAllSessions', () => {
  it('returns all sessions across repos', () => {
    createSession(makeSession({ sessionId: 'SESS_X', repoOwner: 'acme', repoName: 'api' }));
    createSession(makeSession({ sessionId: 'SESS_Y', repoOwner: 'other', repoName: 'repo' }));
    expect(listAllSessions()).toHaveLength(2);
  });
});

describe('listSessionsByStage', () => {
  it('filters by stage', () => {
    createSession(makeSession({ sessionId: 'SESS_C', stage: 'investigating' }));
    createSession(makeSession({ sessionId: 'SESS_D', stage: 'planning' }));
    const sessions = listSessionsByStage('investigating');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('SESS_C');
  });
});

describe('activeSessionExists', () => {
  it('returns true when an active session exists', () => {
    createSession(makeSession({ sessionId: 'SESS_E', stage: 'investigating', issueType: 'MISSING_IDEMPOTENCY_KEY', sourceRef: 'ref1' }));
    expect(activeSessionExists('acme', 'api', 'MISSING_IDEMPOTENCY_KEY', 'ref1')).toBe(true);
  });

  it('returns false when no session exists', () => {
    expect(activeSessionExists('acme', 'api', 'MISSING_IDEMPOTENCY_KEY', 'ref_none')).toBe(false);
  });

  it('returns false for merged sessions (terminal)', () => {
    createSession(makeSession({ sessionId: 'SESS_F', stage: 'merged', issueType: 'MISSING_IDEMPOTENCY_KEY', sourceRef: 'ref2' }));
    expect(activeSessionExists('acme', 'api', 'MISSING_IDEMPOTENCY_KEY', 'ref2')).toBe(false);
  });

  it('returns false for skipped sessions (terminal)', () => {
    createSession(makeSession({ sessionId: 'SESS_G', stage: 'skipped', issueType: 'MISSING_IDEMPOTENCY_KEY', sourceRef: 'ref3' }));
    expect(activeSessionExists('acme', 'api', 'MISSING_IDEMPOTENCY_KEY', 'ref3')).toBe(false);
  });

  it('returns false for closed sessions (terminal)', () => {
    createSession(makeSession({ sessionId: 'SESS_H', stage: 'closed', issueType: 'MISSING_IDEMPOTENCY_KEY', sourceRef: 'ref4' }));
    expect(activeSessionExists('acme', 'api', 'MISSING_IDEMPOTENCY_KEY', 'ref4')).toBe(false);
  });

  it('returns false for blocked sessions (blocked is NOT active — watcher retries)', () => {
    createSession(makeSession({ sessionId: 'SESS_I', stage: 'blocked', issueType: 'MISSING_IDEMPOTENCY_KEY', sourceRef: 'ref5' }));
    expect(activeSessionExists('acme', 'api', 'MISSING_IDEMPOTENCY_KEY', 'ref5')).toBe(false);
  });
});

describe('getNextRunNumber', () => {
  it('returns 1 when no sessions exist', () => {
    expect(getNextRunNumber('acme', 'api', 'MISSING_IDEMPOTENCY_KEY', 'ref_new')).toBe(1);
  });

  it('returns maxRunNumber + 1 when sessions exist', () => {
    createSession(makeSession({ sessionId: 'SESS_J', runNumber: 3, sourceRef: 'refA' }));
    expect(getNextRunNumber('acme', 'api', 'MISSING_IDEMPOTENCY_KEY', 'refA')).toBe(4);
  });
});
