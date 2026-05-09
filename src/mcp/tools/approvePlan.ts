// src/mcp/tools/approvePlan.ts
// MCP tool: Gate 1 plan approval without process.exit().

import { getSession, saveSession } from '../../db/queries/sessions.js';
import { STAGE }                   from '../../lib/constants.js';
import type { ApprovePlanInput, ToolResult } from '../types.js';
import { textResult }              from '../types.js';

/**
 * Approves a Gate 1 plan programmatically, advancing the session to EXECUTING.
 * Identical to `vigilant approve <sessionId>` but safe to call from MCP context.
 *
 * Note: this only flips DB state. The executor picks it up on the next daemon tick.
 * Run `vigilant start` in a separate terminal to keep the daemon running.
 */
export function handleApprovePlan(input: ApprovePlanInput): ToolResult {
  const session = getSession(input.sessionId);

  if (!session) {
    return textResult(`❌ Session \`${input.sessionId}\` not found.`);
  }

  if (session.stage !== STAGE.AWAITING_APPROVAL) {
    if (session.stage === STAGE.AWAITING_MERGE) {
      return textResult(
        `ℹ️  Session \`${input.sessionId}\` is at Gate 2 (awaiting merge).\n\n` +
        `Gate 2 (merge) is not available via MCP — run \`vigilant session ${input.sessionId}\` in your terminal.`,
      );
    }
    return textResult(
      `❌ Cannot approve: session is in stage \`${session.stage}\`.\n\n` +
      `Only sessions in \`awaiting_approval\` can be approved via this tool.`,
    );
  }

  if (!session.plan) {
    return textResult(
      `❌ Session \`${input.sessionId}\` has no plan yet — the agent may still be investigating.`,
    );
  }

  // Advance to EXECUTING — the daemon's executor picks this up on the next tick
  session.stage = STAGE.EXECUTING;
  saveSession(session);

  const changeList = session.plan.changes
    ?.map(c => `- \`${c.path}\`: ${c.description}`)
    .join('\n') ?? '';

  return textResult(
    `✅ Plan approved. Session \`${input.sessionId}\` will proceed to execution on the next daemon tick.\n\n` +
    `**Branch:** \`${session.branchName ?? 'TBD'}\`\n` +
    `**Files to change:** ${session.plan.changes?.length ?? 0}\n` +
    (changeList ? `\n${changeList}` : '') +
    `\n\n> Make sure \`vigilant start\` is running in a separate terminal to execute the fix.`,
  );
}
