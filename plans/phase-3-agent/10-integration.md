# Phase 3 — Integration

**File:** `src/agent/index.ts`

## Objective

The public API for Phase 3. The daemon calls `startAgentSession()` with a `DetectedIssue`; everything else (session creation, loop, plan generation, HITL handoff) happens inside. Phase 4 (HITL) polls `listActiveSessions()` to find sessions in `awaiting_approval`.

---

## Imports from Other Phases

| Import | From | Purpose |
|---|---|---|
| `getStateDb`, `getKnowledgeDb` | Phase 1 `@/db` | SQLite connections |
| `createLogger` | Phase 1 `@/lib/logger` | Structured logging |
| `VigilantConfig` | Phase 1 `@/lib/config` | Config type |
| `VigilantError`, `GitHubAPIError`, `AIProviderError` | Phase 1 `@/lib/errors` | Error hierarchy |
| `SESSION_ID_PREFIX`, `STAGE` | Phase 1 `@/lib/constants` | String literals |
| `githubClient` | Phase 1 `@/lib/github` | Octokit singleton |
| `DetectedIssue` | Phase 2 `@/watcher/types` | Issue handed from watcher |

## Exports to Other Phases

| Export | Used by | Purpose |
|---|---|---|
| `startAgentSession()` | Phase 2 daemon | Start investigation for a detected issue |
| `resumeInterruptedSessions()` | Phase 2 daemon startup | Restart sessions from before crash |
| `listActiveSessions()` | Phase 4 HITL | Find sessions awaiting approval |
| `IssueSession`, `IssueStage`, `Plan` | Phases 4, 5 | Core session types |
| `loadActiveDomainPacks()` | Phase 2 daemon | Load enabled domain packs on startup |
| `DomainPack`, `PatternRule`, `FixStrategy` | Phase 8 domain packs | Domain interfaces |

---

## Public API

```typescript
// src/agent/index.ts

import { runAgentLoop }              from './loop';
import { generatePlan }              from './planGenerator';
import { saveSession, advanceStage } from './stateManager';
import { buildDomainPromptBlock,
         findPackForIssueType }      from './domainContext';
import { createLogger }              from '@/lib/logger';
import { SESSION_ID_PREFIX }         from '@/lib/constants';
import type { DetectedIssue, ExternalToolFinding } from '@/watcher/types';
import type { DomainPack }           from './domainContext';
import type { IssueSession }         from './types';
import type { VigilantConfig }       from '@/lib/config';

const logger = createLogger('agent');

/**
 * Entry point called by the daemon when the watcher hands off a DetectedIssue.
 * Creates a new session, saves it, then runs the agentic loop.
 * toolFindings: optional findings from Snyk/CodeRabbit/Dependabot — used as agent context,
 *   not instructions. Empty array = fallback mode (vigilant is the reviewer).
 * Returns when the session reaches 'awaiting_self_review' (hands off to self-reviewer)
 * or 'blocked'.
 */
export async function startAgentSession(
  issue: DetectedIssue,
  activePacks: DomainPack[],
  config: VigilantConfig,
  toolFindings: ExternalToolFinding[] = [],
): Promise<IssueSession> {
  const pack = findPackForIssueType(activePacks, issue.issueType);
  if (!pack) throw new VigilantError(`No domain pack for issueType: ${issue.issueType}`);

  const runNumber = await getNextRunNumber(issue.repoOwner, issue.repoName);
  const sessionId = buildSessionId(issue, runNumber);

  const session: IssueSession = {
    sessionId,
    repoOwner:       issue.repoOwner,
    repoName:        issue.repoName,
    domain:          issue.domain,
    issueType:       issue.issueType,
    stage:           'discovered',
    severity:        issue.severity,
    confidence:      issue.confidence,
    sourceRef:       issue.sourceRef,
    evidence:        issue.evidence,
    iterationCount:  0,
    goalProgress:    0,
    keyFindings:     [],
    dataCollected:   {
      evidence:     issue.evidence,
      toolFindings: toolFindings,  // stored as context for investigation
      fallbackMode: toolFindings.length === 0,
    },
    plan:            null,
    branchName:      null,
    prNumber:        null,
    prUrl:           null,
    prHeadSha:       null,
    ciStatus:        null,
    executorStep:    null,
    selfReviewCount: 0,
    blockerReason:   null,
    stallCount:      0,
    runNumber,
    createdAt:       new Date().toISOString(),
    updatedAt:       new Date().toISOString(),
  };

  saveSession(session);
  advanceStage(session, 'investigating');
  logger.info(`Session started`, sessionId, {
    issueType: issue.issueType,
    sourceRef: issue.sourceRef,
    toolsPresent: toolFindings.length > 0,
  });

  return runAgentLoop(session, pack, config);
}

// SESS_vigilant_{ISSUE_TYPE}_{owner}_{repo}_{run padded to 3 digits}
function buildSessionId(issue: DetectedIssue, run: number): string {
  const pad = String(run).padStart(3, '0');
  return `${SESSION_ID_PREFIX}_${issue.issueType}_${issue.repoOwner}_${issue.repoName}_${pad}`;
}
```

---

## Session Stage Flow

```
watcher hands off DetectedIssue + ExternalToolFinding[]
  ↓
startAgentSession() → stage: discovered → investigating
  ↓
runAgentLoop() — reads code, git history, team decisions, RAG, tool findings as context
  ↓
stage: planning → plan generated
  ↓
stage: awaiting_self_review → self-reviewer picks up (Phase 5)
  ↓
stage: self_reviewing (max 3 iterations)
  ↓
stage: awaiting_approval → HITL Gate 1 (Phase 4)
  ↓
stage: executing → executor runs (Phase 5)
```

---

## Startup Sequence (How Phase 3 Boots Inside the Daemon)

```
daemon start
  │
  ├── loadActiveDomainPacks(config)         ← Phase 3
  ├── loadDomainSeeds(pack) × N             ← Phase 3 (idempotent)
  ├── resumeInterruptedSessions(packs)      ← Phase 3
  └── startWatcherLoop(packs, config)       ← Phase 2
        │
        └── on new DetectedIssue + tool findings
              └── startAgentSession(issue, packs, config, toolFindings)  ← Phase 3
```
