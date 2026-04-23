# Phase 5 — Implementation Checklist

## Types (`01-types.md`)
- [ ] Create `src/executor/types.ts`
- [ ] `ExecutorStep` type: `not_started | branch_created | files_written | pr_created | ci_monitoring`
- [ ] `ExecutorContext` type: `{ owner, repo, branchName, baseSha }`
- [ ] `FileWriteResult` type: `{ path, commitSha, success, error? }`
- [ ] `CICheckResult` type: `{ status, runId, runUrl, failedJob? }`
- [ ] Add `executor_step` column to `agent_sessions` via migration in `getStateDb()`
- [ ] Add `pr_number`, `pr_url`, `ci_status` columns via migration

## Branch Creator (`02-branch-creator.md`)
- [ ] Create `src/executor/branch-creator.ts`
- [ ] `resolveBaseSha(octokit, owner, repo)` — `repos.get()` then `git.getRef()` → returns `{ defaultBranch, sha }`
- [ ] `createBranch(octokit, ctx)` — `git.createRef()` with `refs/heads/{branchName}`
- [ ] Handle `422 Reference already exists` — return branch name, continue (restart recovery)
- [ ] Handle `403 Resource not accessible` — throw `ExecutorError` with clear message
- [ ] Branch name format: `vigilant/fix/{issueType-kebab}-{shortSha}`

## Code Writer (`03-code-writer.md`)
- [ ] Create `src/executor/code-writer.ts`
- [ ] `writeFileChange(octokit, neurolink, session, ctx, change)` — read + generate + write
- [ ] `repos.getContent()` to read file + SHA; handle `404` as new file (no SHA)
- [ ] Handle files returned with `download_url` (>1MB) using `fetch(download_url)`
- [ ] `neurolink.generate()` with full FIX_PROMPT: path + issue type + change description + original content
- [ ] `repos.createOrUpdateFileContents()` — include `sha` for updates, omit for new files
- [ ] Writes are sequential (not parallel) to avoid SHA conflicts on same branch
- [ ] `writeAllChanges()` — loops all `plan.changes`, returns `FileWriteResult[]`
- [ ] Commit message format: `fix({scope}): {description} [vigilant]` with session/domain/issue body

## PR Creator (`04-pr-creator.md`)
- [ ] Create `src/executor/pr-creator.ts`
- [ ] `buildPRBody(session)` — markdown with severity emoji, summary, root cause, changes, test suggestions, session info table
- [ ] `createPR(octokit, session, ctx, defaultBranch)` — `pulls.create()` → returns `{ prNumber, prUrl, prSha }`
- [ ] PR title format: `fix({issueType_lower}): {plan.summary} [vigilant]`
- [ ] Add labels: `vigilant`, `domain:{domain}`, `severity:{severity_lower}` via `issues.addLabels()`
- [ ] Label failure is non-fatal (wrapped in try/catch)
- [ ] Check for existing open PR on branch before creating (restart recovery)

## CI Monitor (`05-ci-monitor.md`)
- [ ] Create `src/executor/ci-monitor.ts`
- [ ] `monitorCI(octokit, owner, repo, prHeadSha)` — polls until all runs complete or timeout
- [ ] `pollOnce()` — `actions.listWorkflowRunsForRepo({ head_sha })` → classify: pending / success / failure
- [ ] `getFirstFailedJobName()` — `actions.listJobsForWorkflowRun()` → return first failed job name
- [ ] POLL_INTERVAL_MS = 60_000 (60s), TIMEOUT_MS = 30 * 60_000 (30 min)
- [ ] On success: return `{ status: 'success', runId, runUrl }`
- [ ] On failure: return `{ status: 'failure', runId, runUrl, failedJob }`
- [ ] On timeout: return `{ status: 'failure', runId: 0, runUrl: '', failedJob: 'timed out' }`

## Orchestrator (`06-orchestrator.md`)
- [ ] Create `src/executor/index.ts` — `runExecutor(session, octokit, neurolink)`
- [ ] Load `executorStep` from session; skip all steps at or before it
- [ ] Step 1: `resolveBaseSha` + `createBranch` → save `executor_step = 'branch_created'`
- [ ] Step 2: `writeAllChanges` → on any failure, `markBlocked` with failed paths → save `files_written`
- [ ] Step 3: `createPR` → save `pr_number`, `pr_url`, `executor_step = 'pr_created'`
- [ ] Step 4: `monitorCI` → save `executor_step = 'ci_monitoring'`, then handle result
- [ ] CI success: `UPDATE agent_sessions SET stage = 'awaiting_merge', ci_status = 'passed'`
- [ ] CI failure: `markBlocked` with `"CI failed: {jobName}"`
- [ ] `saveExecutorStep(db, sessionId, step)` helper

## Error Recovery (`07-error-recovery.md`)
- [ ] `retryExecutor(sessionId, octokit, neurolink)` — reset stage to `approved`, keep `executorStep` intact
- [ ] Called by `vigilant retry <id>` command
- [ ] Table: all failure scenarios, blocker reason written, recovery action
- [ ] Non-recoverable failures: 403 push access, 403 PR creation — not auto-retried
- [ ] Partial file write recovery: all files re-written (idempotent — GitHub handles duplicate content)

## Commit Messages (`08-commit-messages.md`)
- [ ] `buildCommitMessage(session, change)` — Conventional Commits format
- [ ] First line ≤ 72 chars, body lines ≤ 80 chars
- [ ] Body includes: Session ID, Domain, Issue type
- [ ] Each file in a multi-file session gets its own commit with same session ID

## Rate Limiting (`09-rate-limiting.md`)
- [ ] All GitHub API calls wrapped with `callWithRetry` from Phase 3
- [ ] 429 handler reads `Retry-After` header and waits accordingly
- [ ] Budget calculation: max 35 API calls per session, safe at 20 concurrent sessions
- [ ] Parallel executor runs use `Promise.allSettled` across sessions (not within a session)

## Self-Review Loop (`11-self-review-loop.md`)
- [ ] Create `src/executor/self-reviewer.ts` — `runSelfReview(session, neurolink)`
- [ ] Add `SelfReviewResult` and `SelfReviewIssue` types to `src/executor/types.ts`
- [ ] Add `MAX_SELF_REVIEW_ITERATIONS = 3` constant to `src/lib/constants.ts`
- [ ] Build plan summary string from `session.plan.changes` for the review prompt
- [ ] Call `neurolink.generate()` with review prompt + JSON response format
- [ ] Parse `{ clean, issues }` from response; fall back to `clean: true` on parse error
- [ ] Apply corrections: append issues to PR body + test suggestions if clean check fails
- [ ] Increment `self_review_count` in SQLite after each iteration
- [ ] After `MAX_SELF_REVIEW_ITERATIONS` or a clean pass → set `stage: awaiting_approval`
- [ ] NeuroLink failure during self-review → log + treat as clean (do not block Gate 1)

## Integration (`10-integration.md`)
- [ ] Agent loop calls `runSelfReview(session, neurolink)` after plan generation
- [ ] Daemon picks up `awaiting_approval` sessions (not `approved`) via `listSessionsByStage`
- [ ] `Promise.allSettled` for parallel execution across sessions
- [ ] After `awaiting_merge` transition: `enqueueGate(GATE_2, sessionId)` if not already queued
- [ ] Gate 2 merge: `pulls.merge({ merge_method: 'squash' })` + stage = `done`
- [ ] New columns documented: `executor_step`, `pr_number`, `pr_url`, `ci_status`, `self_review_count`

## Verification
- [ ] Approving a plan in Gate 1 triggers branch creation on GitHub
- [ ] Each file in `plan.changes` is committed with correct message format
- [ ] PR appears on GitHub with all required sections in body
- [ ] Labels `vigilant`, `domain:*`, `severity:*` appear on the PR
- [ ] Session ID in PR body matches `SESS_vigilant_*` format
- [ ] `vigilant session <id>` shows `executorStep` progress
- [ ] Killing daemon mid-write and restarting skips completed files
- [ ] CI pass → stage becomes `awaiting_merge`, Gate 2 queued
- [ ] CI fail → stage becomes `blocked`, blocker reason contains job name
- [ ] `vigilant retry <id>` on a blocked session re-queues for execution from saved step
