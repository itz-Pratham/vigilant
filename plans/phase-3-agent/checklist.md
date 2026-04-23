# Phase 3 — Implementation Checklist

## Types (`01-types.md`)
- [ ] Create `src/agent/types.ts` — `IssueStage` union (13 values), `Severity`, `FileChange`, `Plan`, `IssueSession` with full JSDoc
- [ ] Add `AgentToolName`, `AgentToolCall`, `AgentToolResult` types
- [ ] `IssueSession.selfReviewCount: number` field present and defaults to 0

## prepareStep (`02-loop.md`)
- [ ] Create `src/agent/prepare-step.ts` — `buildPrepareStep(iterationCount)` returns `PrepareStep | undefined`
- [ ] Iteration 0 → `{ tool: 'getCurrentTime' }`
- [ ] Iteration 1 → `{ tool: 'sequentialThinking' }`
- [ ] Iteration 2+ → `undefined` (toolChoice: 'auto')

## Agentic Loop (`02-loop.md`)
- [ ] Create `src/agent/loop.ts` — `runAgentLoop(session, pack, config): Promise<IssueSession>`
- [ ] Call `buildInvestigationSystemPrompt(session, pack)` on every iteration
- [ ] Call `callWithRetry(() => neurolink.generate(...))` with prepareStep enforcement
- [ ] Execute tool calls returned by the model via `executeToolCall()`
- [ ] Extract `goalProgress` after every iteration via `extractGoalProgress()`
- [ ] Call `saveSession(session)` after every iteration without exception
- [ ] Break loop when `goalProgress >= GOAL_PROGRESS_THRESHOLD`
- [ ] Break loop when `iterationCount >= config.maxIterations` → `markBlocked(session, 'MAX_ITERATIONS_REACHED')`

## Tools (`03-tools.md`)
- [ ] Create `src/agent/tools.ts` — all 9 tool definitions in NeuroLink tool format
- [ ] Create `src/agent/tool-executor.ts` — `executeToolCall(call, session)` dispatcher
- [ ] `readFile` — GitHub Contents API, base64 decode, return first 200 lines with line numbers
- [ ] `searchCode` — GitHub Search API scoped to `repo:owner/name`, return matched lines
- [ ] `ragSearch` — `searchDocuments(scope, domain, query)`, always passes scope
- [ ] `readPRDiff` — fetch PR metadata + files list, return combined diff string
- [ ] `searchWeb` — delegate to NeuroLink web search, return summarised results
- [ ] `readGitHistory` — GitHub commits API, filters by file path, returns 7-char SHA + message + author + date
- [ ] `readTeamDecisions` — auto-discovers decision.md, adr/, docs/decisions; returns content up to 3KB each
- [ ] `getCurrentTime` — returns `new Date().toISOString()`
- [ ] `sequentialThinking` — returns the model's own `thought` field as confirmation

## Plan Generator (`04-plan-generator.md`)
- [ ] Create `src/agent/plan-generator.ts` — `generatePlan(session, pack): Promise<Plan>`
- [ ] Build plan generation prompt from `keyFindings`, `dataCollected`, and `fixStrategy.exampleAfter`
- [ ] Call NeuroLink with `outputFormat: 'json'`
- [ ] Implement `validatePlan(raw)` — throws if no `fileChanges` array or array is empty
- [ ] Advance session to `awaiting_self_review` after successful plan generation (self-review loop in Phase 5 transitions to `awaiting_approval`)

## State Manager (`05-state-manager.md`)
- [ ] Create `src/agent/state-manager.ts` — `loadSession`, `saveSession`, `advanceStage`, `markBlocked`, `resumeFromBlocked`
- [ ] `saveSession` uses `INSERT OR REPLACE` — handles both create and update
- [ ] `advanceStage('blocked')` always stores `previousStage` in `dataCollected`
- [ ] `resumeFromBlocked` clears `blockerReason` and restores `previousStage`
- [ ] `listActiveSessions(owner, repo)` — excludes terminal stages
- [ ] `findInterruptedSessions()` — returns all `stage = 'investigating'` rows
- [ ] `sessionExistsForIssue(owner, repo, issueType, sourceRef)` — used by watcher dedup

## Domain Context (`06-domain-context.md`)
- [ ] Create `src/agent/domain-context.ts` — `DomainPack`, `FixStrategy`, `PatternRule` interfaces
- [ ] Implement `buildDomainPromptBlock(pack, issueType)` — formats fix strategy into system prompt block
- [ ] Implement `loadDomainSeeds(pack)` — reads all `.md` files from `knowledge/{domain}/`, calls `addKnowledgeDocument` for each, idempotent
- [ ] Create domain pack registry with all 4 packs: `payments`, `security`, `reliability`, `compliance`
- [ ] Implement `loadActiveDomainPacks(config)` — throws `VigilantError` on unknown domain ID
- [ ] Implement `findPackForIssueType(packs, issueType)` — used by agent and recovery

## Stall Detection (`07-stall-detection.md`)
- [ ] Create `src/agent/stall-detection.ts` — `checkStall(current, state): StallResult`
- [ ] Returns `stalled: false` when progress improves by ≥ `STALL_MIN_DELTA`
- [ ] Returns `stalled: false` when `current >= HIGH_CONFIDENCE` regardless of improvement
- [ ] Returns `stalled: true` after exactly `STALL_THRESHOLD` consecutive stall iterations
- [ ] Implement `extractGoalProgress(response, current)` — JSON block strategy first, NLP fallback second
- [ ] Stall state is in-memory only — resets on restart (intentional)

## Crash Recovery (`08-crash-recovery.md`)
- [ ] Create `src/agent/recovery.ts` — `resumeInterruptedSessions(activePacks, config)`
- [ ] Calls `findInterruptedSessions()` on daemon startup
- [ ] For each interrupted session, looks up the domain pack and re-enters `runAgentLoop`
- [ ] Sessions with no matching domain pack are logged and skipped (not thrown)
- [ ] Resumed sessions start with `initialStallState(session.goalProgress)` — fresh stall counter

## Error Handling (`09-error-handling.md`)
- [ ] Create `src/agent/errors.ts` — `AgentLoopError extends VigilantError`, `ToolExecutionError extends VigilantError`
- [ ] Implement `callWithRetry<T>(fn, sessionId)` — retries on `AIProviderError` with status 429/5xx, exponential backoff, max `AI_MAX_RETRIES` attempts
- [ ] Outer catch in `runAgentLoop` maps each error class to the correct `markBlocked` reason prefix

## Integration / Entry Point (`10-integration.md`)
- [ ] Create `src/agent/index.ts` — `startAgentSession(issue, activePacks, config, toolFindings: ExternalToolFinding[] = []): Promise<IssueSession>`
- [ ] Build session ID: `SESS_vigilant_{ISSUE_TYPE}_{owner}_{repo}_{NNN}`
- [ ] Create session with `stage: 'discovered'`, save, `advanceStage('investigating')`, then call `runAgentLoop`
- [ ] Session initialised with `selfReviewCount: 0`, `toolFindings` and `fallbackMode` stored in `dataCollected`
- [ ] After loop completes at `awaiting_self_review`, return session to caller (self-review loop in Phase 5 picks it up)
- [ ] Export `resumeInterruptedSessions`, `loadActiveDomainPacks`, `loadDomainSeeds` for daemon startup

## Knowledge Seeds
- [ ] Create 5 `.md` seed files under `knowledge/payments/`
- [ ] Create 5 `.md` seed files under `knowledge/security/`
- [ ] Create 5 `.md` seed files under `knowledge/reliability/`
- [ ] Create 5 `.md` seed files under `knowledge/compliance/`

## Verification
- [ ] Given a mock `DetectedIssue`, `startAgentSession` creates a row in `agent_sessions` with `stage = 'investigating'`
- [ ] Step 0 always calls `getCurrentTime`, step 1 always calls `sequentialThinking`
- [ ] Session reaches `stage = 'awaiting_approval'` with a non-null `plan` field
- [ ] Killing the process mid-loop and restarting resumes from last saved `iterationCount`
- [ ] A session with no `goalProgress` improvement for 3 iterations is marked `blocked`
- [ ] `loadDomainSeeds` run twice does not create duplicate RAG documents
- [ ] `sessionExistsForIssue` returns `true` for all non-terminal stages
