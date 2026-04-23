# Phase 5 — Executor

## Goal

Fully autonomous execution of an approved plan. After Gate 1 approval, the executor creates a branch, writes every code change, commits, opens a PR, and monitors CI — without any human input until Gate 2.

## In Scope

- `BranchCreator`: creates a git branch on GitHub
- `CodeWriter`: reads each file, generates the fix using NeuroLink, writes back to GitHub
- `PRCreator`: creates a PR with a structured, informative body
- `CIMonitor`: polls GitHub Actions for the PR's CI status
- Executor orchestrator: runs all four in sequence, saves progress after each step
- Partial failure recovery: if any step fails, session is marked `blocked` with exact failure context

## Out of Scope

- Gate 2 merge decision (Phase 4 handles this)
- Any AI investigation (Phase 3)
- Learning mode (Phase 6)

## File Structure Created

```
src/
├── executor/
│   ├── index.ts            ← runExecutor(session): orchestrates all steps
│   ├── branch-creator.ts   ← creates branch via GitHub Refs API
│   ├── code-writer.ts      ← reads file, generates fix, writes back
│   ├── pr-creator.ts       ← creates PR with structured body
│   └── ci-monitor.ts       ← polls Actions API until CI completes
```

## Step-by-Step Execution

### Step 1 — Create Branch

```typescript
// POST /repos/{owner}/{repo}/git/refs
await octokit.git.createRef({
  owner, repo,
  ref: `refs/heads/${session.plan.branchName}`,
  sha: mainBranchSha   // get from GET /repos/{owner}/{repo}/git/ref/heads/main
});
```

### Step 2 — Write Each File Change (per FileChange in plan.changes)

```
For each FileChange:
  1. GET /repos/{owner}/{repo}/contents/{path}?ref={branchName}
     → get current content (base64) and file SHA
  2. Decode content to string
  3. NeuroLink.generate(prompt: apply this FileChange to this content)
     → returns new file content as string
  4. PUT /repos/{owner}/{repo}/contents/{path}
     body: { message, content: base64(newContent), sha: fileSha, branch: branchName }
  5. Save step progress to SQLite (so partial failures are recoverable)
```

### Step 3 — Create PR

PR body template:
```markdown
## Summary
{plan.summary}

## Root Cause
{plan.rootCause}

## Changes
{plan.changes.map(c => `- **${c.path}**: ${c.description}`)}

## Test Suggestions
{plan.testSuggestions.map(t => `- ${t}`)}

---
*Created by [vigilant](https://github.com/yourname/vigilant)*
*Session: `{session.sessionId}`*
*Domain: {session.domain} · Issue: {session.issueType}*
```

### Step 4 — Monitor CI

```
Poll every 60 seconds:
  GET /repos/{owner}/{repo}/actions/runs?head_sha={prHeadSha}
  → find runs triggered by the PR branch
  → if all runs completed with status=success → set ciStatus='passed', transition to awaiting_merge
  → if any run failed → set ciStatus='failed', mark session blocked, surface to human
  → if still in_progress → continue polling
```

## Partial Failure Recovery

Executor saves a `executorStep` field to the session after each step:
- `branch_created` — branch exists, move on to code writing
- `files_written` — all files written, move on to PR
- `pr_created` — PR exists, move on to CI monitoring

On restart, executor checks `executorStep` and skips already-completed steps.

## Success Criteria

- After Gate 1 approval, a branch is created on GitHub with the correct name
- Each file in `plan.changes` is updated on the branch with AI-generated fix
- A PR is opened with the full structured body including session ID
- CI status is polled and `ciStatus` in SQLite is updated when checks complete
- Session transitions to `awaiting_merge` when CI passes
- If executor crashes mid-way, restarting picks up from the last completed step
- If CI fails, session is marked `blocked` with the failed job name in `blockerReason`
