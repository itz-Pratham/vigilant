# Phase 3 — Agent

## Goal

A complete agentic loop that takes a `DetectedIssue`, investigates it autonomously using NeuroLink, and produces a structured `Plan`. This is the cognitive core of vigilant — the part that thinks, not just watches.

## In Scope

- `IssueSession` type with the full stage machine
- `AgentStateManager`: save and load session from SQLite after every step
- `prepareStep` enforcement: step 0 = `getCurrentTime`, step 1 = `sequentialThinking`, steps 2–N = `toolChoice: auto`
- All agent tools: `readFile`, `searchCode`, `ragSearch`, `readPRDiff`, `searchWeb`
- Main agentic loop: runs until `goalProgress >= 0.9` or max iterations reached
- Plan generation: produces a structured `Plan` JSON object from investigation findings
- `goalProgress` stall detection: if no progress after 3 consecutive iterations, mark `blocked`
- Session ID generation

## Out of Scope

- HITL gates (Phase 4) — agent ends at `awaiting_approval`, HITL picks up from there
- Executor (Phase 5) — plan execution is not part of this phase
- Learning mode (Phase 6)

## File Structure Created

```
src/
├── agent/
│   ├── index.ts            ← startSession(issue): entry point called by watcher
│   ├── types.ts            ← IssueSession, IssueStage, Plan, FileChange, AgentTool
│   ├── state-manager.ts    ← load/save session to SQLite, crash recovery
│   ├── prepare-step.ts     ← enforces mandatory step 0 and step 1
│   ├── tools.ts            ← all tool definitions passed to NeuroLink
│   ├── loop.ts             ← main agentic loop function
│   └── plan-generator.ts   ← extracts structured Plan from agent findings
```

## Core Types

```typescript
type IssueStage =
  | 'discovered'
  | 'investigating'
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'pr_created'
  | 'awaiting_merge'
  | 'merged'
  | 'skipped'
  | 'closed'
  | 'blocked';

type FileChange = {
  path: string;
  description: string;
  before: string;       // the problematic code (for display in Gate 1)
  after: string;        // the proposed fix (for display in Gate 1)
  lineHint?: number;    // approximate line number for context
};

type Plan = {
  summary: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidence: number;
  rootCause: string;
  changes: FileChange[];
  branchName: string;
  prTitle: string;
  prBodyMarkdown: string;
  testSuggestions: string[];
};

type IssueSession = {
  sessionId: string;
  repoOwner: string;
  repoName: string;
  domain: string;
  issueType: string;
  stage: IssueStage;
  severity: string;
  confidence: number;
  sourceRef: string;
  iterationCount: number;
  goalProgress: number;   // 0.0–1.0
  keyFindings: string[];
  dataCollected: Record<string, unknown>;
  plan: Plan | null;
  branchName: string | null;
  prNumber: number | null;
  prUrl: string | null;
  ciStatus: string | null;
  blockerReason: string | null;
  createdAt: string;
  updatedAt: string;
};
```

## prepareStep Logic

Adapted directly from Lighthouse `executor.ts`:

```typescript
function buildPrepareStep(iterationCount: number, tool: string): PrepareStep | undefined {
  if (iterationCount === 0) {
    return { tool: 'getCurrentTime' };          // step 0: mandatory
  }
  if (iterationCount === 1) {
    return { tool: 'sequentialThinking' };      // step 1: mandatory
  }
  return undefined;                             // steps 2+: toolChoice: 'auto'
}
```

## Agent Tools

| Tool name | What it does | API used |
|---|---|---|
| `readFile` | Reads a file from the repo at a given path | GitHub Contents API |
| `searchCode` | Searches the repo for a query string | GitHub Search API |
| `ragSearch` | Queries the knowledge base with scope enforcement | NeuroLink RAG |
| `readPRDiff` | Gets the full diff of a PR | GitHub PRs API |
| `searchWeb` | Searches the web for context | NeuroLink web search |

## Agentic Loop Logic

```
loop(session):
  while session.goalProgress < 0.9 AND session.iterationCount < maxIterations:
    1. Build prepareStep (mandatory for iterations 0 and 1)
    2. Call NeuroLink.generate() with:
       - system prompt: investigation prompt for this issueType
       - tools: all agent tools
       - prepareStep: as built above
       - toolChoice: 'auto' (after iteration 1)
    3. Execute any tool calls returned by the model
    4. Extract goalProgress, keyFindings, dataCollected from response
    5. Save session state to SQLite
    6. Check stall: if goalProgress unchanged for 3 iterations → mark blocked
    7. Increment iterationCount

  if goalProgress >= 0.9:
    run plan-generator to produce Plan
    update session stage to 'awaiting_approval'
    save Plan to SQLite
    return session
```

## Session ID Generation

```typescript
function generateSessionId(issue: DetectedIssue, runNumber: number): string {
  const shortRepo = `${issue.repoOwner}_${issue.repoName}`;
  const run = String(runNumber).padStart(3, '0');
  return `SESS_vigilant_${issue.issueType}_${shortRepo}_${run}`;
}
```

Run number increments if a session for the same issueType + sourceRef was previously resolved (merged/skipped/closed).

## Success Criteria

- Given a `DetectedIssue`, `startSession` creates a session in SQLite with stage `discovered`
- The agent loop runs, calls at least `getCurrentTime` and `sequentialThinking` as first two steps
- After investigation, session transitions to `awaiting_approval` with a populated `Plan`
- Killing the process mid-loop and restarting resumes from the last saved state
- If `goalProgress` stalls for 3 iterations, session is marked `blocked` and logged
