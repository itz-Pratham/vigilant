# Phase 2 — Daemon Loop

**File:** `src/watcher/index.ts`

## Objective

The daemon loop is the heartbeat of vigilant. It runs forever (until the process is killed), calling `watcherTick` on each interval. It manages the interval scheduling, handles global errors so a single tick failure cannot crash the whole daemon, and orchestrates all five scanners in parallel on each tick.

---

## Full Implementation

```typescript
import type { StartOptions } from '@/cli/types';
import type { WatcherTickSummary, DetectedIssue } from '@/watcher/types';
import { loadConfig } from '@/config/index';
import { loadDomainPack } from '@/agent/domain-packs';
import { scanPRs } from './scanners/pr-scanner';
import { scanCommits } from './scanners/commit-scanner';
import { scanCI } from './scanners/ci-scanner';
import { scanDependencies } from './scanners/dep-scanner';
import { scanPatterns } from './scanners/pattern-scanner';
import { activeSessionExists, getNextRunNumber } from '@/db/queries/sessions';
import { startSession } from '@/agent/index';
import { runLearnJob } from '@/learner/index';
import { info, warn, error } from '@/lib/logger';
import chalk from 'chalk';

let isRunning = false;

/**
 * Start the vigilant daemon for a given repo.
 * Runs indefinitely until process is killed.
 */
export async function startDaemon(opts: StartOptions): Promise<void> {
  const config = loadConfig();
  const [owner, repo] = opts.repo.split('/');

  if (!owner || !repo) {
    error(`Invalid repo format: "${opts.repo}". Use owner/repo.`, 'daemon');
    process.exit(1);
  }

  const domain = opts.domain ?? config.domains[0];
  const intervalSeconds = opts.interval
    ? Math.max(parseInt(opts.interval, 10), 30)
    : config.watchIntervalSeconds;

  // Print startup banner
  console.log(chalk.bold.cyan('\n  vigilant daemon starting\n'));
  console.log(`  Repo:     ${chalk.white(opts.repo)}`);
  console.log(`  Domain:   ${chalk.white(domain)}`);
  console.log(`  Interval: ${chalk.white(intervalSeconds + 's')}`);
  console.log(`  Press Ctrl+C to stop\n`);

  info(`Daemon started`, 'daemon', { repo: opts.repo, domain, intervalSeconds });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    info('Daemon stopping (SIGINT)', 'daemon');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    info('Daemon stopping (SIGTERM)', 'daemon');
    process.exit(0);
  });

  // Resume any in-progress sessions from before shutdown
  await resumeInProgressSessions(owner, repo);

  // Run first tick immediately, then on interval
  await runTick(owner, repo, domain);

  setInterval(async () => {
    if (isRunning) {
      warn('Previous tick still running, skipping this tick', 'watcher');
      return;
    }
    await runTick(owner, repo, domain);
  }, intervalSeconds * 1000);

  // Keep process alive
  await new Promise(() => {});
}

async function runTick(owner: string, repo: string, domain: string): Promise<void> {
  isRunning = true;
  const tickStart = new Date().toISOString();

  try {
    const domainPack = loadDomainPack(domain);
    const patternRules = domainPack.patternRules;

    // Run all scanners in parallel
    const [prResult, commitResult, ciResult, depResult, patternResult] = await Promise.allSettled([
      scanPRs({ owner, repo, domain, patternRules }),
      scanCommits({ owner, repo, domain, patternRules }),
      scanCI({ owner, repo, domain, patternRules }),
      scanDependencies({ owner, repo, domain }),
      scanPatterns({ owner, repo, domain, patternRules }),
    ]);

    // Collect all issues from settled results (ignore scanner failures individually)
    const allIssues: DetectedIssue[] = [];
    const scanResults = [];

    for (const result of [prResult, commitResult, ciResult, depResult, patternResult]) {
      if (result.status === 'fulfilled') {
        allIssues.push(...result.value.issues);
        scanResults.push(result.value);
      } else {
        warn(`Scanner failed: ${result.reason?.message}`, 'watcher');
      }
    }

    // Deduplicate against existing active sessions
    const newIssues: DetectedIssue[] = [];
    const deduplicatedCount = { count: 0 };

    for (const issue of allIssues) {
      const exists = activeSessionExists(owner, repo, issue.issueType, issue.sourceRef);
      if (exists) {
        deduplicatedCount.count++;
      } else {
        newIssues.push(issue);
      }
    }

    // Start agent sessions for new issues
    let newSessionsStarted = 0;
    for (const issue of newIssues) {
      await startSession(issue);
      newSessionsStarted++;
    }

    // If no issues, run one learning job
    if (newIssues.length === 0) {
      info('No new issues found. Entering learning mode for this tick.', 'watcher');
      await runLearnJob({ domain, repo: `${owner}/${repo}` }).catch(err => {
        warn(`Learning job failed: ${err.message}`, 'learner');
      });
    }

    const summary: WatcherTickSummary = {
      repo: `${owner}/${repo}`,
      domain,
      tickStartedAt: tickStart,
      tickCompletedAt: new Date().toISOString(),
      scanResults,
      totalIssuesFound: allIssues.length,
      newSessionsStarted,
      deduplicatedIssues: deduplicatedCount.count,
      notModifiedResponses: scanResults.filter(r => r.notModified).length,
    };

    info(
      `Tick complete — ${newSessionsStarted} new sessions, ${deduplicatedCount.count} deduplicated, ${summary.notModifiedResponses} unchanged`,
      'watcher',
      { totalFound: allIssues.length }
    );

  } catch (err: unknown) {
    error(`Tick failed: ${(err as Error).message}`, 'watcher');
    // Do NOT rethrow — daemon must keep running
  } finally {
    isRunning = false;
  }
}

async function resumeInProgressSessions(owner: string, repo: string): Promise<void> {
  const { listSessionsByStage } = await import('@/db/queries/sessions');
  const investigating = listSessionsByStage('investigating')
    .filter(s => s.repoOwner === owner && s.repoName === repo);

  if (investigating.length > 0) {
    info(`Resuming ${investigating.length} in-progress sessions from before shutdown`, 'daemon');
    for (const session of investigating) {
      const { resumeSession } = await import('@/agent/index');
      resumeSession(session.sessionId).catch(err => {
        error(`Failed to resume session ${session.sessionId}: ${err.message}`, 'daemon');
      });
    }
  }
}
```
