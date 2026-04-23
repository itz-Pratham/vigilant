# Phase 7 — MCP Types

**File:** `src/mcp/types.ts`

## Objective

Zod schemas for all MCP tool inputs and TypeScript types for all outputs. The MCP SDK uses these schemas to validate incoming tool calls and generate the tools' JSON Schema for clients.

---

## Implementation

```typescript
// src/mcp/types.ts
import { z } from 'zod';

// ── list_known_issues ─────────────────────────────────────────────────────
export const ListKnownIssuesInput = z.object({
  domain: z.enum(['payments', 'security', 'reliability', 'compliance']).optional(),
  status: z.enum([
    'discovered', 'investigating', 'planning',
    'awaiting_self_review', 'self_reviewing',
    'awaiting_approval', 'executing', 'pr_created',
    'awaiting_merge', 'merged', 'skipped', 'closed', 'blocked',
  ]).optional(),
  limit:  z.number().int().min(1).max(50).default(10),
});
export type ListKnownIssuesInput = z.infer<typeof ListKnownIssuesInput>;

export type SessionSummary = {
  sessionId:  string;
  domain:     string;
  issueType:  string;
  severity:   string;
  stage:      string;
  repo:       string;
  detectedAt: number;
  prUrl?:     string;
};

// ── analyze_snippet ───────────────────────────────────────────────────────
export const AnalyzeSnippetInput = z.object({
  code:     z.string().max(10_000),
  language: z.string().default('typescript'),
  domain:   z.enum(['payments', 'security', 'reliability', 'compliance']).optional(),
});
export type AnalyzeSnippetInput = z.infer<typeof AnalyzeSnippetInput>;

export type AnalyzeSnippetOutput = {
  issueType?:   string;
  severity?:    'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  confidence:   number;     // 0.0 – 1.0
  explanation:  string;
  suggestion?:  string;     // one-sentence fix hint
};

// ── get_domain_pattern ────────────────────────────────────────────────────
export const GetDomainPatternInput = z.object({
  issueType: z.string(),   // e.g. 'MISSING_IDEMPOTENCY'
});
export type GetDomainPatternInput = z.infer<typeof GetDomainPatternInput>;

export type DomainPatternOutput = {
  issueType:   string;
  domain:      string;
  severity:    string;
  description: string;
  badExample:  string;
  goodExample: string;
  searchQuery: string;
};

// ── get_session_status ────────────────────────────────────────────────────
export const GetSessionStatusInput = z.object({
  sessionId: z.string(),
});
export type GetSessionStatusInput = z.infer<typeof GetSessionStatusInput>;

// ── approve_plan ──────────────────────────────────────────────────────────
export const ApprovePlanInput = z.object({
  sessionId:     z.string(),
  modifications: z.string().optional(),  // optional instruction to modify plan before approving
});
export type ApprovePlanInput = z.infer<typeof ApprovePlanInput>;

export type ApprovePlanOutput = {
  success: boolean;
  message: string;
};
```

---

## Zod Dependency

`zod` is already a transitive dependency of `@modelcontextprotocol/sdk`. No separate installation needed.
