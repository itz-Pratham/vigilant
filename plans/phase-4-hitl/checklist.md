# Phase 4 — Implementation Checklist

## Types (`01-types.md`)
- [ ] Create `src/hitl/types.ts` — `Gate1Decision`, `Gate2Decision`, `RendererSection`, `SeverityColour`, `PendingGate`

## Renderer (`02-renderer.md`)
- [ ] Create `src/hitl/renderer.ts` — `renderBox(title, sections, severity)` with fixed 66-char width chalk box
- [ ] Severity colours: CRITICAL=red.bold, HIGH=yellow.bold, MEDIUM=cyan, LOW=grey
- [ ] `renderPlanLines(fileChanges)` — numbered steps with before/after first line
- [ ] `renderCIStatus(ciStatus, passed, total)` — ✅/❌/⏳ formatted string

## Gate 1 — Plan Approval (`03-gate1.md`)
- [ ] Create `src/hitl/plan-approval.ts` — `gateOne(session, pack, config): Promise<Gate1Decision>`
- [ ] Render plan box: meta section, PLAN section (numbered file changes), branch/PR section, action prompt
- [ ] `inquirer.select` prompt: Approve / Modify / Skip
- [ ] Approve → `advanceStage(session, 'executing')`, return `'approved'`
- [ ] Skip → `advanceStage(session, 'skipped')`, return `'skipped'`
- [ ] Modify → `inquirer.editor` with plan summary pre-fill, inject instructions into `dataCollected`, call `generatePlan`, recurse

## Gate 2 — Merge Approval (`04-gate2.md`)
- [ ] Create `src/hitl/merge-approval.ts` — `gateTwo(session): Promise<Gate2Decision>`
- [ ] Render PR box: PR number + title, CI status line, PR URL, action prompt
- [ ] `inquirer.select` prompt: Merge / Review first / Close
- [ ] Merge → `PUT /repos/{owner}/{repo}/pulls/{number}/merge` (squash), `advanceStage('merged')`
- [ ] Close → `PATCH /repos/{owner}/{repo}/pulls/{number}` body `{state:'closed'}`, `advanceStage('closed')`
- [ ] Review → log warning, no stage change, return `'review'`

## Status Command (`05-status-command.md`)
- [ ] Create `src/cli/commands/status.ts` — `runStatusCommand(options)`
- [ ] Default: show non-terminal sessions + terminal sessions updated in last 24h
- [ ] `--all` flag: show everything from last 7 days
- [ ] `cli-table3` table with columns: SESSION ID, STAGE, SEV, DOMAIN, UPDATED
- [ ] Stage column colour-coded; blocker reason shown in red after stage if present
- [ ] Footer line when sessions need action: "N session(s) need your attention"
- [ ] Wire to `vigilant status [--all]` in `src/cli/index.ts`

## Session Command (`06-session-command.md`)
- [ ] Create `src/cli/commands/session.ts` — `runSessionCommand(sessionId)`
- [ ] Print full detail: stage, severity, domain, issueType, sourceRef, updated time, blocker reason
- [ ] Print keyFindings list if non-empty
- [ ] Print plan summary (title, risk, branch, file changes) if plan exists
- [ ] Print PR URL + CI status if PR exists
- [ ] If `stage === 'awaiting_approval'` → call `gateOne()` inline
- [ ] If `stage === 'awaiting_merge'` → call `gateTwo()` inline
- [ ] Wire to `vigilant session <id>` in `src/cli/index.ts`

## Approve Command (`07-approve-command.md`)
- [ ] Create `src/cli/commands/approve.ts` — `runApproveCommand(sessionId)`
- [ ] Validate session exists and is at `awaiting_approval` — exit 1 otherwise
- [ ] `advanceStage(session, 'executing')` and print confirmation
- [ ] Wire to `vigilant approve <id>` in `src/cli/index.ts`
- [ ] Gate 2 is intentionally NOT auto-approvable

## Gate Queue (`08-gate-queue.md`)
- [ ] Create `src/hitl/gateQueue.ts` — `enqueueGate(sessionId, gate)` and `processQueue()`
- [ ] `enqueueGate` deduplicates — same sessionId+gate not added twice
- [ ] `processQueue` is serial — one gate prompt at a time, never concurrent
- [ ] Skip queued session if stage has already changed by the time it's processed
- [ ] `reQueuePendingGates()` — on startup, re-queues all sessions at `awaiting_approval` or `awaiting_merge`

## Modification Flow (`09-modification-flow.md`)
- [ ] `humanModifyInstructions` stored in `session.dataCollected` (overwritten each cycle, not appended)
- [ ] `buildPlanGenerationPrompt` in `planGenerator.ts` injects modify instructions when present
- [ ] Editor pre-fill template includes current plan title and file change list
- [ ] Modification loop is recursive — no hard depth limit

## Integration (`10-integration.md`)
- [ ] `src/hitl/index.ts` — exports `gateOne`, `gateTwo`, `enqueueGate`, `reQueuePendingGates`
- [ ] Daemon (`src/watcher/index.ts`) calls `enqueueGate(sessionId, 1)` after `startAgentSession` returns at `awaiting_approval`
- [ ] Daemon tick polls for `stage = 'executing'` sessions and calls `runExecutor()` (Phase 5)
- [ ] `reQueuePendingGates()` added to daemon startup sequence after `resumeInterruptedSessions`

## Verification
- [ ] Session at `awaiting_approval` triggers Gate 1 box in the terminal
- [ ] Approving transitions to `executing` in SQLite immediately
- [ ] Skipping transitions to `skipped`
- [ ] Modify flow re-generates plan and re-displays before re-prompting
- [ ] `vigilant approve <id>` from a second terminal sets stage to `executing`
- [ ] `vigilant approve <id>` on a non-`awaiting_approval` session exits with code 1 and a message
- [ ] Gate 2 box shows correct PR number, CI status, and URL
- [ ] Merge calls GitHub API; session moves to `merged`
- [ ] Two sessions reaching Gate 1 simultaneously display prompts one at a time, not concurrently
- [ ] `reQueuePendingGates` on restart re-surfaces all pending gates
