# Phase 7 — approve_plan Tool

**File:** `src/mcp/tools/approvePlan.ts`

## Objective

Approve a Gate 1 plan programmatically from inside an MCP client. Identical logic to `vigilant approve <sessionId>`. Optional `modifications` string allows the human to request plan changes before approving.

---

## Implementation

```typescript
// src/mcp/tools/approvePlan.ts
import Database              from 'better-sqlite3';
import { ApprovePlanInput, ApprovePlanOutput } from '../types.js';
import { loadSession }       from '../../agent/state-manager.js';
import { runApproveCommand } from '../../commands/approve.js';

export async function handleApprovePlan(
  db:    Database.Database,
  input: ApprovePlanInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const session = loadSession(db, input.sessionId);

  if (!session) {
    return result(false, `Session \`${input.sessionId}\` not found.`);
  }

  if (session.stage !== 'awaiting_approval') {
    return result(
      false,
      `Session is in stage \`${session.stage}\` — can only approve sessions in \`awaiting_approval\`.`,
    );
  }

  if (!session.plan) {
    return result(false, `Session has no plan yet. Agent may still be investigating.`);
  }

  try {
    await runApproveCommand(db, input.sessionId, input.modifications);
    return result(
      true,
      `Plan approved. Session \`${input.sessionId}\` will now proceed to execution.\n\n` +
      `Branch: \`${session.plan.branchName}\`\n` +
      `Files to change: ${session.plan.changes.length}`,
    );
  } catch (err: any) {
    return result(false, `Approval failed: ${err.message}`);
  }
}

function result(
  success: boolean,
  message: string,
): { content: Array<{ type: 'text'; text: string }> } {
  const prefix = success ? '✅' : '❌';
  return { content: [{ type: 'text', text: `${prefix} ${message}` }] };
}
```

---

## Gate 2 is NOT Exposed via MCP

Gate 2 (merge) is intentionally not exposed as an MCP tool. The human must be physically present at the terminal to merge. This is a deliberate safety constraint — AI editors can approve investigation plans, but not push code to production branches.

---

## Modifications Flow

If `input.modifications` is provided:
1. `runApproveCommand` passes modifications to the plan generator
2. The plan is re-generated with the modification instructions
3. The new plan is saved to SQLite
4. Stage advances to `executing`

This is the non-interactive equivalent of selecting "Modify" in Gate 1 and typing instructions.

---

## Example Interaction

**User in Claude Desktop chat:**
> Approve session SESS_vigilant_MISSING_IDEMPOTENCY_acme_api_001 but also add a comment explaining why we need idempotency

**Claude calls `approve_plan`:**
```json
{
  "sessionId": "SESS_vigilant_MISSING_IDEMPOTENCY_acme_api_001",
  "modifications": "Also add a JSDoc comment to the createPayment function explaining why the idempotency key is required"
}
```

**Response:**
```
✅ Plan approved. Session `SESS_vigilant_MISSING_IDEMPOTENCY_acme_api_001` will now proceed to execution.

Branch: `vigilant/fix/missing-idempotency-a1b2c3d`
Files to change: 1
```
