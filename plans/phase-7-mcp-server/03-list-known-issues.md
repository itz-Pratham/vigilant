# Phase 7 — list_known_issues Tool

**File:** `src/mcp/tools/listKnownIssues.ts`

## Objective

Return all active (non-closed, non-done) vigilant sessions for the watched repo, with optional filtering by domain and stage. This lets an AI editor surface the backlog of detected issues without running any new scans.

---

## Implementation

```typescript
// src/mcp/tools/listKnownIssues.ts
import Database                   from 'better-sqlite3';
import { ListKnownIssuesInput, SessionSummary } from '../types.js';

export async function handleListKnownIssues(
  db:    Database.Database,
  input: ListKnownIssuesInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  let query = `
    SELECT session_id, domain, issue_type, severity, stage,
           owner || '/' || repo as repo,
           detected_at, pr_url
    FROM agent_sessions
    WHERE stage NOT IN ('merged', 'closed')
  `;
  const params: any[] = [];

  if (input.domain) {
    query += ` AND domain = ?`;
    params.push(input.domain);
  }

  if (input.status) {
    query += ` AND stage = ?`;
    params.push(input.status);
  }

  query += ` ORDER BY detected_at DESC LIMIT ?`;
  params.push(input.limit);

  const rows = db.prepare(query).all(...params) as any[];

  const sessions: SessionSummary[] = rows.map(r => ({
    sessionId:  r.session_id,
    domain:     r.domain,
    issueType:  r.issue_type,
    severity:   r.severity,
    stage:      r.stage,
    repo:       r.repo,
    detectedAt: r.detected_at,
    prUrl:      r.pr_url ?? undefined,
  }));

  const text = sessions.length === 0
    ? 'No active vigilant sessions found.'
    : formatSessionList(sessions);

  return { content: [{ type: 'text', text }] };
}

function formatSessionList(sessions: SessionSummary[]): string {
  const lines = sessions.map(s => {
    const age = formatAge(s.detectedAt);
    const pr  = s.prUrl ? ` | PR: ${s.prUrl}` : '';
    return `• [${s.severity}] ${s.issueType} (${s.domain}) — ${s.stage} — ${s.repo} — ${age}${pr}`;
  });

  return `Found ${sessions.length} active session(s):\n\n${lines.join('\n')}`;
}

function formatAge(ts: number): string {
  const diff = Date.now() - ts;
  const mins  = Math.floor(diff / 60_000);
  if (mins < 60)  return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
```

---

## Example Output (in Cursor chat)

```
Found 3 active session(s):

• [CRITICAL] MISSING_IDEMPOTENCY (payments) — awaiting_approval — acme/backend — 12m ago
• [HIGH] SECRET_IN_CODE (security) — investigating — acme/backend — 47m ago
• [MEDIUM] NO_CIRCUIT_BREAKER (reliability) — blocked — acme/backend — 3h ago | PR: https://github.com/acme/backend/pull/42
```
