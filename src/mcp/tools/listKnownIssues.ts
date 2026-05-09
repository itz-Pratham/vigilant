// src/mcp/tools/listKnownIssues.ts
// MCP tool: list active vigilant sessions with DB-side filtering.

import { getStateDb }             from '../../db/index.js';
import type { ListKnownIssuesInput, ToolResult } from '../types.js';
import { textResult }             from '../types.js';

/** Stages that are considered terminal and excluded from the default "known issues" view. */
const TERMINAL_STAGES = ['merged', 'closed', 'skipped'] as const;

/** One session row returned by the DB query. */
type SessionRow = {
  session_id:  string;
  domain:      string;
  issue_type:  string;
  severity:    string;
  stage:       string;
  repo:        string;
  created_at:  string;
  pr_url:      string | null;
  blocker_reason: string | null;
};

/**
 * Lists active (non-terminal) vigilant sessions with optional domain/stage filtering.
 * Filtering and limiting are done in SQLite — not in TypeScript — for performance.
 */
export function handleListKnownIssues(input: ListKnownIssuesInput): ToolResult {
  const db     = getStateDb();
  const params: (string | number)[] = [];

  // Build query with DB-side filtering
  const whereClauses: string[] = [];

  if (input.status) {
    // Caller asked for a specific stage — honour it exactly
    whereClauses.push('stage = ?');
    params.push(input.status);
  } else {
    // Default: exclude terminal stages
    const placeholders = TERMINAL_STAGES.map(() => '?').join(', ');
    whereClauses.push(`stage NOT IN (${placeholders})`);
    params.push(...TERMINAL_STAGES);
  }

  if (input.domain) {
    whereClauses.push('domain = ?');
    params.push(input.domain);
  }

  const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const sql   = `
    SELECT session_id, domain, issue_type, severity, stage,
           repo_owner || '/' || repo_name AS repo,
           created_at, pr_url, blocker_reason
    FROM agent_sessions
    ${where}
    ORDER BY created_at DESC
    LIMIT ?
  `;
  params.push(input.limit);

  const rows = db.prepare(sql).all(...params) as SessionRow[];

  if (rows.length === 0) {
    return textResult('No active vigilant sessions found.');
  }

  const lines = rows.map(r => {
    const age = formatAge(r.created_at);
    const pr  = r.pr_url ? ` | PR: ${r.pr_url}` : '';
    const blocker = r.blocker_reason ? ` ⚠ ${r.blocker_reason}` : '';
    return `• \`${r.session_id}\` [${r.severity}] ${r.issue_type} (${r.domain}) — **${r.stage}** — ${r.repo} — ${age}${pr}${blocker}`;
  });

  return textResult(`Found ${rows.length} active session(s):\n\n${lines.join('\n')}`);
}

function formatAge(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins  = Math.floor(diff / 60_000);
  if (mins < 60)  return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
