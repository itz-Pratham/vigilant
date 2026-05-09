// src/mcp/types.ts
// Zod schemas (raw shapes) and TypeScript types for all 5 MCP tools.

import { z } from 'zod';

// ── list_known_issues ─────────────────────────────────────────────────────────

export const listKnownIssuesShape = {
  domain: z.enum(['payments', 'security', 'reliability', 'compliance']).optional()
    .describe('Filter by domain pack'),
  status: z.enum([
    'discovered', 'investigating', 'planning',
    'awaiting_self_review', 'self_reviewing',
    'awaiting_approval', 'executing', 'pr_created',
    'awaiting_merge', 'merged', 'skipped', 'closed', 'blocked',
  ]).optional().describe('Filter by session stage'),
  limit: z.number().int().min(1).max(50).optional().default(10)
    .describe('Max number of sessions to return (default 10)'),
};

export type ListKnownIssuesInput = {
  domain?: 'payments' | 'security' | 'reliability' | 'compliance';
  status?: string;
  limit:   number;
};

// ── analyze_snippet ───────────────────────────────────────────────────────────

export const analyzeSnippetShape = {
  code:     z.string().max(10_000).describe('The code snippet to analyse'),
  language: z.string().optional().default('typescript')
    .describe('Programming language of the snippet'),
  domain: z.enum(['payments', 'security', 'reliability', 'compliance']).optional()
    .describe('Domain to check against (optional — checks all if omitted)'),
};

export type AnalyzeSnippetInput = {
  code:     string;
  language: string;
  domain?:  'payments' | 'security' | 'reliability' | 'compliance';
};

export type AnalyzeSnippetOutput = {
  issueType?:  string | null;
  severity?:   'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | null;
  confidence:  number;
  explanation: string;
  suggestion?: string | null;
};

// ── get_domain_pattern ────────────────────────────────────────────────────────

export const getDomainPatternShape = {
  issueType: z.string().describe('Issue type identifier, e.g. MISSING_IDEMPOTENCY_KEY'),
  domain:    z.enum(['payments', 'security', 'reliability', 'compliance']).optional()
    .describe('Domain hint when issue type exists in multiple domains'),
};

export type GetDomainPatternInput = {
  issueType: string;
  domain?:   'payments' | 'security' | 'reliability' | 'compliance';
};

// ── get_session_status ────────────────────────────────────────────────────────

export const getSessionStatusShape = {
  sessionId: z.string().describe('The vigilant session ID'),
};

export type GetSessionStatusInput = {
  sessionId: string;
};

// ── approve_plan ──────────────────────────────────────────────────────────────

export const approvePlanShape = {
  sessionId: z.string().describe('The vigilant session ID to approve'),
};

export type ApprovePlanInput = {
  sessionId: string;
};

// ── MCP tool result ───────────────────────────────────────────────────────────

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
};

/** Convenience builder for a single-text MCP tool result. */
export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}
