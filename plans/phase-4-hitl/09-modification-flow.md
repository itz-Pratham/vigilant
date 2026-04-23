# Phase 4 — Modification Flow

**File:** Part of `src/hitl/plan-approval.ts`

## Objective

When the human selects "Modify" at Gate 1, they get an editor prompt pre-filled with the current plan summary. After saving, the agent re-generates the plan with the human's instructions injected as additional context, then re-displays. This loop continues until the human approves or skips.

---

## Data Flow

```
gateOne(session)
  │
  ├── display plan box
  ├── inquirer.select → 'modify'
  │
  ├── inquirer.editor  ← pre-filled with current plan summary
  │         │
  │         └── human types instructions, saves
  │
  ├── session.dataCollected.humanModifyInstructions = instructions
  ├── generatePlan(session, pack)   ← re-generates using new context
  ├── session.plan = newPlan
  │
  └── gateOne(session, pack, config)  ← recursive — re-displays, re-prompts
```

---

## How Plan Generator Uses Modify Instructions

In `src/agent/planGenerator.ts`, the plan generation prompt includes the modify instructions when present:

```typescript
// src/agent/planGenerator.ts

function buildPlanGenerationPrompt(session: IssueSession): string {
  const base = [
    `You are generating a code fix plan for the following issue:`,
    `Issue type: ${session.issueType}`,
    `Key findings: ${session.keyFindings.join('; ')}`,
    `Data collected: ${JSON.stringify(session.dataCollected, null, 2)}`,
  ];

  const modifyInstructions = session.dataCollected.humanModifyInstructions as string | undefined;
  if (modifyInstructions) {
    base.push('');
    base.push('HUMAN MODIFICATION INSTRUCTIONS (must be followed):');
    base.push(modifyInstructions);
    base.push('The previous plan did not satisfy these instructions. Generate a revised plan.');
  }

  base.push('');
  base.push('Return a JSON object matching the Plan schema.');
  return base.join('\n');
}
```

---

## Recursion Safety

The modification loop is recursive (`gateOne` calls itself). Depth is bounded by the human always eventually choosing approve or skip. There is no technical limit imposed — it is a deliberate UX decision that the human controls the loop.

`humanModifyInstructions` is overwritten on each modify cycle, not appended. Only the most recent instructions are passed to the plan generator. Previous modify cycles are not included — the new plan is generated fresh each time.

---

## Editor Pre-fill Content

The editor opens with a structured template:

```
Current plan: {plan.title}

Files to change:
  1. checkout/payment.ts — Add idempotency key to createPayment call
  2. checkout/payment.ts — Import crypto from 'node:crypto'

Your instructions for changes to this plan:
(Replace this text with your modifications)
```

The human replaces the last section. Everything above it is context — the generator ignores structure and reads the full text.
