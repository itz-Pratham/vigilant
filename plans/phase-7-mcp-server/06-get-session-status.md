# Phase 7 — get_session_status Tool

**File:** `src/mcp/tools/getSessionStatus.ts`

## Objective

Return complete session details for a given session ID — same output as `vigilant session <id>` but accessible from within any MCP client.

---

## Implementation

```typescript
// src/mcp/tools/getSessionStatus.ts
import Database                  from 'better-sqlite3';
import { GetSessionStatusInput } from '../types.js';
import { loadSession }           from '../../agent/state-manager.js';

export async function handleGetSessionStatus(
  db:    Database.Database,
  input: GetSessionStatusInput,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const session = loadSession(db, input.sessionId);

  if (!session) {
    return {
      content: [{
        type: 'text',
        text: `Session \`${input.sessionId}\` not found.`,
      }],
    };
  }

  const lines: string[] = [
    `## Session: \`${session.sessionId}\``,
    '',
    `| Field          | Value |`,
    `|---|---|`,
    `| Stage          | **${session.stage}** |`,
    `| Domain         | ${session.domain} |`,
    `| Issue type     | \`${session.issueType}\` |`,
    `| Severity       | ${session.severity} |`,
    `| Repository     | ${session.owner}/${session.repo} |`,
    `| Detected at    | ${new Date(session.detectedAt).toISOString()} |`,
    `| Iteration      | ${session.iterationCount} |`,
  ];

  if (session.prUrl) {
    lines.push(`| PR             | [View PR](${session.prUrl}) |`);
  }

  if (session.blockerReason) {
    lines.push(`| Blocker        | ${session.blockerReason} |`);
  }

  if (session.plan) {
    lines.push('');
    lines.push('### Plan');
    lines.push(session.plan.summary);
    lines.push('');
    lines.push('**Root cause:** ' + session.plan.rootCause);
    lines.push('');
    lines.push('**Changes:**');
    for (const c of session.plan.changes) {
      lines.push(`- \`${c.path}\`: ${c.description}`);
    }
    if (session.plan.testSuggestions?.length) {
      lines.push('');
      lines.push('**Test suggestions:**');
      for (const t of session.plan.testSuggestions) {
        lines.push(`- ${t}`);
      }
    }
  }

  if (session.stage === 'awaiting_approval') {
    lines.push('');
    lines.push('> **Action required:** Run `vigilant approve ' + session.sessionId + '` or use the `approve_plan` MCP tool to approve this plan.');
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}
```

---

## Example Output

```markdown
## Session: `SESS_vigilant_MISSING_IDEMPOTENCY_acme_api_001`

| Field          | Value |
|---|---|
| Stage          | **awaiting_approval** |
| Domain         | payments |
| Issue type     | `MISSING_IDEMPOTENCY` |
| Severity       | CRITICAL |
| Repository     | acme/backend |
| Detected at    | 2024-01-15T14:22:00.000Z |
| Iteration      | 7 |

### Plan
Add idempotency key to createPayment() in payment service

**Root cause:** The `createPayment` function in `src/services/payment.ts` calls `stripe.charges.create()` without an idempotency key, risking duplicate charges on network retry.

**Changes:**
- `src/services/payment.ts`: Add `idempotencyKey: uuidv4()` to stripe.charges.create call

**Test suggestions:**
- Test that retrying createPayment with the same parameters does not create a duplicate charge

> **Action required:** Run `vigilant approve SESS_vigilant_MISSING_IDEMPOTENCY_acme_api_001`
```
