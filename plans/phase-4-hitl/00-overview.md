# Phase 4 — HITL (Human in the Loop)

## Goal

Two terminal UI gates. Gate 1 surfaces the plan and waits for human approval before any code is written. Gate 2 surfaces the PR and CI status and waits for a merge decision. These are the only two moments a human interacts with vigilant.

## In Scope

- Gate 1: `PlanApprovalPrompt` — full plan display in a styled terminal box, approve/modify/skip
- Gate 2: `MergeApprovalPrompt` — PR info display, merge/review/close
- Modification flow at Gate 1: human edits the plan as free text, agent re-evaluates, re-shows
- `vigilant status` command: table of all sessions with current stage and severity
- `vigilant session <sessionId>` command: full detail view of one session
- `vigilant approve <sessionId>` command: approves Gate 1 from a second terminal (programmatic)
- Session state updated in SQLite based on human decision at each gate

## Out of Scope

- Any HITL beyond these two gates
- Executor (Phase 5) — runs after Gate 1 approval

## File Structure Created

```
src/
├── hitl/
│   ├── index.ts            ← exports gatOne(session), gateTwo(session)
│   ├── plan-approval.ts    ← Gate 1 render + inquirer prompt
│   ├── merge-approval.ts   ← Gate 2 render + inquirer prompt
│   └── renderer.ts         ← chalk box rendering utilities
```

## Gate 1 — Plan Approval Display

```
╔══════════════════════════════════════════════════════════════╗
║  vigilant  ·  HIGH  ·  SESS_vigilant_MISSING_IDEMPOTENCY_…  ║
╠══════════════════════════════════════════════════════════════╣
║  ISSUE     Missing idempotency key in payment creation       ║
║  SOURCE    PR #47 · checkout/payment.ts:47                   ║
║  DOMAIN    payments                                          ║
║  RISK      Duplicate charges possible on network retry       ║
╠══════════════════════════════════════════════════════════════╣
║  PLAN                                                        ║
║  ① checkout/payment.ts:47                                    ║
║    Before: createPayment({ amount, currency })               ║
║    After:  createPayment({ amount, currency,                 ║
║             idempotencyKey: crypto.randomUUID() })           ║
║                                                              ║
║  ② checkout/payment.ts:3                                     ║
║    Before: (no import)                                       ║
║    After:  import crypto from 'node:crypto'                  ║
╠══════════════════════════════════════════════════════════════╣
║  Branch    vigilant/fix/idempotency-pr47                     ║
║  PR title  fix(idempotency): add key to checkout [vigilant]  ║
╠══════════════════════════════════════════════════════════════╣
║  [a] Approve   [m] Modify plan   [s] Skip                   ║
╚══════════════════════════════════════════════════════════════╝
```

## Gate 1 — Modification Flow

If human selects `[m] Modify`:
1. Show current plan summary as editable text via `inquirer` editor prompt
2. Human edits the plan instructions (freeform text, not JSON)
3. Re-run `plan-generator` with the human's modifications as additional context
4. Re-display the updated plan
5. Re-prompt: approve / modify again / skip

## Gate 2 — Merge Approval Display

```
╔══════════════════════════════════════════════════════════════╗
║  vigilant  ·  PR READY  ·  SESS_vigilant_…                  ║
╠══════════════════════════════════════════════════════════════╣
║  PR #52    fix(idempotency): add key to checkout [vigilant]  ║
║  CI        ✅ 3/3 checks passed                              ║
║  Changes   2 files · +9 lines · -1 line                     ║
║  Link      github.com/org/repo/pull/52                       ║
╠══════════════════════════════════════════════════════════════╣
║  [m] Merge   [r] I'll review first   [c] Close              ║
╚══════════════════════════════════════════════════════════════╝
```

## Status Command Output

`vigilant status` shows a table:

```
SESSION ID                                    STAGE             SEVERITY  DOMAIN    UPDATED
SESS_vigilant_MISSING_IDEMPOTENCY_org_r_001  awaiting_approval HIGH      payments  2m ago
SESS_vigilant_WEBHOOK_NO_SIGNATURE_org_r_001 executing         CRITICAL  payments  30s ago
SESS_vigilant_SQL_INJECTION_org_r_001        investigating     HIGH      security  5m ago
```

## Success Criteria

- When a session reaches `awaiting_approval`, the plan is displayed in the terminal box
- `[a]` approve transitions session to `executing` in SQLite
- `[m]` modify shows an editor, re-generates plan, re-displays
- `[s]` skip transitions session to `skipped` in SQLite
- `vigilant approve <sessionId>` from a second terminal has the same effect as `[a]`
- When a session reaches `awaiting_merge`, Gate 2 is displayed with correct PR info
- `[m]` merge calls GitHub merge API and transitions session to `merged`
- `vigilant status` shows a correct, up-to-date table of all sessions
