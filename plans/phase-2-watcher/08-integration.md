# Phase 2 — Integration

**File:** `src/watcher/index.ts`

## Objective

Phase 2's public API. The daemon imports `startWatcher()` and calls it once on startup. Internally it orchestrates the five scanners on a `setInterval`, deduplicates issues against SQLite, and calls `startAgentSession()` (Phase 3) for each new unique issue.

---

## Imports from Phase 1

| Import | From |
|---|---|
| `githubRequest`, `conditionalGet` | `@/lib/github` |
| `info`, `warn`, `error` | `@/lib/logger` |
| `getWatcherState`, `upsertWatcherState` | `@/db/queries/watcher` |
| `sessionExistsForIssue` | `@/db/queries/sessions` |
| `VigilantConfig` | `@/config/types` |
| `GitHubRateLimitError` | `@/lib/errors` |
| `DEFAULT_WATCH_INTERVAL_SECONDS`, `LEARNER_IDLE_TICKS_TRIGGER` | `@/lib/constants` |

## Exports to Phase 3 / Daemon

| Export | Used by |
|---|---|
| `startWatcher(repo, packs, config)` | `src/cli/commands/start.ts` |
| `DetectedIssue` (re-export from types) | Phase 3 `startAgentSession()` |

---

## Full Orchestrator

```typescript
// src/watcher/index.ts

import { scanPRs }        from './scanners/pr-scanner';
import { scanCommits }    from './scanners/commit-scanner';
import { scanCI }         from './scanners/ci-scanner';
import { scanDeps }       from './scanners/dep-scanner';
import { scanPatterns }   from './scanners/pattern-scanner';
import { runToolObserver } from './tool-observer';
import { startAgentSession }     from '@/agent';
import { runLearner }            from '@/learner';
import { sessionExistsForIssue } from '@/db/queries/sessions';
import { info, warn, error }     from '@/lib/logger';
import { DEFAULT_WATCH_INTERVAL_SECONDS, LEARNER_IDLE_TICKS_TRIGGER } from '@/lib/constants';
import type { DomainPack }      from '@/agent/domainContext';
import type { VigilantConfig }  from '@/config/types';
import type { DetectedIssue, ToolObserverResult } from './types';

export async function startWatcher(
  repoSlug: string,        // "owner/repo"
  activePacks: DomainPack[],
  config: VigilantConfig,
  db: Database.Database,
  kdb: Database.Database,
  octokit: Octokit,
  neurolink: NeuroLink,
): Promise<void> {
  const [owner, repo] = repoSlug.split('/');
  const intervalMs = (config.watchIntervalSeconds ?? DEFAULT_WATCH_INTERVAL_SECONDS) * 1000;

  info(`Watching ${repoSlug} every ${intervalMs / 1000}s`, 'watcher');

  let idleTickCount = 0;

  const tick = async () => {
    info(`Tick started`, 'watcher');

    const allIssues: DetectedIssue[] = [];

    // Run all five scanners in parallel; isolate failures per scanner
    const results = await Promise.allSettled(
      activePacks.flatMap(pack => [
        scanPRs(     { owner, repo, patternRules: pack.patternRules }),
        scanCommits( { owner, repo, defaultBranch: 'main', patternRules: pack.patternRules }),
        scanCI(      { owner, repo, ciKeywords: pack.ciKeywords, patternRules: pack.patternRules }),
        scanDeps(    { owner, repo, activeDomains: [pack.id] }),
        scanPatterns({ owner, repo, patternRules: pack.patternRules }),
      ]),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allIssues.push(...result.value.issues);
      } else {
        warn(`Scanner failed: ${(result.reason as Error).message}`, 'watcher');
      }
    }

    // Deduplicate: skip any issue already tracked in a non-terminal session
    const newIssues = allIssues.filter(
      issue => !sessionExistsForIssue(issue.repoOwner, issue.repoName, issue.issueType, issue.sourceRef),
    );

    // Run Tool Observer on open PR numbers from this tick's scan results
    const openPrNumbers = allIssues
      .filter(i => i.sourceRef.startsWith('PR#'))
      .map(i => parseInt(i.sourceRef.slice(3), 10))
      .filter((n, idx, arr) => arr.indexOf(n) === idx);

    let toolObserverResults: ToolObserverResult[] = [];
    if (openPrNumbers.length > 0) {
      toolObserverResults = await runToolObserver(owner, repo, openPrNumbers).catch(err => {
        warn(`Tool Observer failed: ${(err as Error).message}`, 'watcher');
        return [];
      });
    }

    info(`Tick complete. ${allIssues.length} issues found, ${newIssues.length} new`, 'watcher');

    if (newIssues.length === 0) {
      idleTickCount++;
    } else {
      idleTickCount = 0;
    }

    // Start agent sessions for new issues (fire-and-forget — loop manages its own errors)
    for (const issue of newIssues) {
      // Find tool findings for this PR, if any — passed as agent context
      const prNum = issue.sourceRef.startsWith('PR#')
        ? parseInt(issue.sourceRef.slice(3), 10) : null;
      const toolFindings = prNum !== null
        ? (toolObserverResults.find(r => r.prNumber === prNum)?.findings ?? [])
        : [];

      startAgentSession(issue, activePacks, config, toolFindings).catch(err => {
        error(`Failed to start session for ${issue.issueType}: ${(err as Error).message}`, 'watcher');
      });
    }

    // Trigger learner after N consecutive idle ticks
    if (idleTickCount >= LEARNER_IDLE_TICKS_TRIGGER) {
      idleTickCount = 0;
      runLearner(db, kdb, octokit, neurolink, { owner, repo }).catch(err => {
        warn(`Learner error: ${(err as Error).message}`, 'watcher');
      });
    }
  };

  // Run first tick immediately, then on interval
  await tick();
  setInterval(tick, intervalMs);
}
```

---

## Startup Position

```
vigilant start
  │
  ├── loadConfig()
  ├── loadActiveDomainPacks(config)     ← Phase 3
  ├── loadDomainSeeds(pack) × N         ← Phase 3
  ├── resumeInterruptedSessions(packs)  ← Phase 3
  └── startWatcher(repo, packs, config, db, kdb, octokit, neurolink) ← Phase 2
```
