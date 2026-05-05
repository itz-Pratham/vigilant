// tests/unit/prompts.test.ts
// Unit tests for src/agent/prompts.ts — focusing on extractProgressUpdate
// since buildInvestigationSystemPrompt and buildIterationContext are pure string builders.

import { describe, it, expect } from 'vitest';
import { extractProgressUpdate, buildInvestigationSystemPrompt, buildIterationContext } from '../../src/agent/prompts.js';
import type { IssueSession } from '../../src/agent/types.js';

const BASE_SESSION: IssueSession = {
  sessionId:       'SESS_test',
  repoOwner:       'acme',
  repoName:        'api',
  domain:          'payments',
  issueType:       'MISSING_IDEMPOTENCY_KEY',
  stage:           'investigating',
  severity:        'HIGH',
  confidence:      0.5,
  sourceRef:       'abc123',
  evidence:        ['found in src/payment.ts line 42'],
  iterationCount:  1,
  goalProgress:    0.3,
  keyFindings:     ['file src/payment.ts has no idempotency key'],
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
  createdAt:       '2024-01-01T00:00:00.000Z',
  updatedAt:       '2024-01-01T00:00:00.000Z',
};

describe('extractProgressUpdate', () => {
  it('extracts progress from a well-formed json block', () => {
    const content = `Some analysis text.

\`\`\`json
{
  "goalProgress": 0.6,
  "keyFindings": ["found issue in payment.ts", "no idempotency key"]
}
\`\`\``;
    const result = extractProgressUpdate(content, BASE_SESSION);
    expect(result.goalProgress).toBeCloseTo(0.6);
    expect(result.keyFindings).toHaveLength(2);
    expect(result.keyFindings[0]).toBe('found issue in payment.ts');
  });

  it('uses the LAST json block when multiple are present', () => {
    const content = `\`\`\`json
{"goalProgress": 0.3, "keyFindings": ["early"]}
\`\`\`

More text.

\`\`\`json
{"goalProgress": 0.8, "keyFindings": ["final finding"]}
\`\`\``;
    const result = extractProgressUpdate(content, BASE_SESSION);
    expect(result.goalProgress).toBeCloseTo(0.8);
    expect(result.keyFindings).toContain('final finding');
  });

  it('clamps goalProgress to 1.0 if model returns > 1', () => {
    const content = `\`\`\`json
{"goalProgress": 1.5, "keyFindings": []}
\`\`\``;
    const result = extractProgressUpdate(content, BASE_SESSION);
    expect(result.goalProgress).toBe(1.0);
  });

  it('clamps goalProgress to 0.0 if model returns < 0', () => {
    const content = `\`\`\`json
{"goalProgress": -0.1, "keyFindings": []}
\`\`\``;
    const result = extractProgressUpdate(content, BASE_SESSION);
    expect(result.goalProgress).toBe(0.0);
  });

  it('truncates keyFindings to 10 items', () => {
    const findings = Array.from({ length: 15 }, (_, i) => `finding ${i}`);
    const content = `\`\`\`json
{"goalProgress": 0.5, "keyFindings": ${JSON.stringify(findings)}}
\`\`\``;
    const result = extractProgressUpdate(content, BASE_SESSION);
    expect(result.keyFindings.length).toBe(10);
  });

  it('falls back to inline regex when no json block found', () => {
    const content = `Progress update: "goalProgress": 0.45 — still investigating`;
    const result = extractProgressUpdate(content, BASE_SESSION);
    expect(result.goalProgress).toBeCloseTo(0.45);
    // keyFindings falls back to session value when using inline match
    expect(result.keyFindings).toEqual(BASE_SESSION.keyFindings);
  });

  it('returns current session values when no progress info found', () => {
    const content = 'No JSON here at all.';
    const result = extractProgressUpdate(content, BASE_SESSION);
    expect(result.goalProgress).toBe(BASE_SESSION.goalProgress);
    expect(result.keyFindings).toEqual(BASE_SESSION.keyFindings);
  });

  it('falls back gracefully when json block contains invalid JSON', () => {
    const content = `\`\`\`json
{invalid json !!
\`\`\``;
    const result = extractProgressUpdate(content, BASE_SESSION);
    // Should not throw; falls back to session values
    expect(result.goalProgress).toBe(BASE_SESSION.goalProgress);
  });

  it('falls back when json block is missing required keys', () => {
    const content = `\`\`\`json
{"somethingElse": 42}
\`\`\``;
    const result = extractProgressUpdate(content, BASE_SESSION);
    expect(result.goalProgress).toBe(BASE_SESSION.goalProgress);
  });
});

describe('buildInvestigationSystemPrompt', () => {
  it('includes repo owner and name', async () => {
    const { findPackForIssueType } = await import('../../src/agent/domain-context.js');
    const pack = findPackForIssueType('MISSING_IDEMPOTENCY_KEY')!;
    const prompt = buildInvestigationSystemPrompt(BASE_SESSION, pack);
    expect(prompt).toContain('acme/api');
    expect(prompt).toContain('MISSING_IDEMPOTENCY_KEY');
  });

  it('includes the required json trailer instruction', async () => {
    const { findPackForIssueType } = await import('../../src/agent/domain-context.js');
    const pack = findPackForIssueType('MISSING_IDEMPOTENCY_KEY')!;
    const prompt = buildInvestigationSystemPrompt(BASE_SESSION, pack);
    expect(prompt).toContain('goalProgress');
    expect(prompt).toContain('keyFindings');
  });
});

describe('buildIterationContext', () => {
  it('shows iteration number', () => {
    const ctx = buildIterationContext(BASE_SESSION, 0);
    expect(ctx).toContain('Iteration 1');
  });

  it('tells agent to start on iteration 0', () => {
    const ctx = buildIterationContext(BASE_SESSION, 0);
    expect(ctx).toContain('Start your investigation');
  });

  it('tells agent to continue on iteration > 0', () => {
    const ctx = buildIterationContext(BASE_SESSION, 1);
    expect(ctx).toContain('Continue your investigation');
  });

  it('lists evidence when present', () => {
    const ctx = buildIterationContext(BASE_SESSION, 0);
    expect(ctx).toContain('found in src/payment.ts line 42');
  });
});
