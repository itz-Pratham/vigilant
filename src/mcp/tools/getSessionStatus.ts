// src/mcp/tools/getSessionStatus.ts
// MCP tool: return full session details by session ID.

import { getSession }             from '../../db/queries/sessions.js';
import type { GetSessionStatusInput, ToolResult } from '../types.js';
import { textResult }             from '../types.js';

/**
 * Returns complete session details for a given session ID,
 * rendered as a markdown table + plan summary.
 */
export function handleGetSessionStatus(input: GetSessionStatusInput): ToolResult {
  const session = getSession(input.sessionId);

  if (!session) {
    return textResult(`Session \`${input.sessionId}\` not found.`);
  }

  const lines: string[] = [
    `## Session: \`${session.sessionId}\``,
    '',
    '| Field | Value |',
    '|---|---|',
    `| Stage | **${session.stage}** |`,
    `| Domain | ${session.domain} |`,
    `| Issue type | \`${session.issueType}\` |`,
    `| Severity | ${session.severity} |`,
    `| Repository | ${session.repoOwner}/${session.repoName} |`,
    `| Detected at | ${session.createdAt} |`,
    `| Iteration | ${session.iterationCount} |`,
  ];

  if (session.prUrl) {
    lines.push(`| PR | [View PR](${session.prUrl}) |`);
  }
  if (session.branchName) {
    lines.push(`| Branch | \`${session.branchName}\` |`);
  }
  if (session.blockerReason) {
    lines.push(`| Blocker | ⚠️ ${session.blockerReason} |`);
  }

  if (session.plan) {
    lines.push('', '### Plan', session.plan.summary ?? '(no summary)');

    if (session.plan.rootCause) {
      lines.push('', `**Root cause:** ${session.plan.rootCause}`);
    }

    if (session.plan.changes?.length) {
      lines.push('', '**Changes:**');
      for (const c of session.plan.changes) {
        lines.push(`- \`${c.path}\`: ${c.description}`);
      }
    }

    if (session.plan.testSuggestions?.length) {
      lines.push('', '**Test suggestions:**');
      for (const t of session.plan.testSuggestions) {
        lines.push(`- ${t}`);
      }
    }
  }

  if (session.stage === 'awaiting_approval') {
    lines.push(
      '',
      `> **Action required:** Use the \`approve_plan\` tool or run \`vigilant approve ${session.sessionId}\` to approve this plan.`,
    );
  }

  if (session.stage === 'awaiting_merge') {
    lines.push(
      '',
      `> **Action required:** Run \`vigilant session ${session.sessionId}\` in your terminal to review and merge the PR.`,
    );
  }

  return textResult(lines.join('\n'));
}
