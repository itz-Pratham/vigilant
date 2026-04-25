// src/watcher/index.ts
// Watcher daemon: poll loop that runs all scanners, deduplicates issues, and fires agent sessions.

import chalk from 'chalk';
import { loadConfig } from '../config/index.js';
import { getStateDb } from '../db/index.js';
import { getWatcherState, upsertWatcherState } from '../db/queries/watcher.js';
import { activeSessionExists, listSessionsByStage } from '../db/queries/sessions.js';
import { resolveActivePacks } from '../agent/domain-context.js';
import { startAgentSession, resumeSession } from '../agent/index.js';
import { info, warn, error as logError, debug } from '../lib/logger.js';
import {
  WATCHER_POLL_INTERVAL_SECONDS,
  LEARNER_IDLE_TICKS_TRIGGER,
  STAGE,
} from '../lib/constants.js';
import { scanPRs }          from './scanners/pr-scanner.js';
import { scanCommits }      from './scanners/commit-scanner.js';
import { scanCI }           from './scanners/ci-scanner.js';
import { scanDependencies } from './scanners/dep-scanner.js';
import { scanPatterns }     from './scanners/pattern-scanner.js';
import { observeAllOpenPRs } from './tool-observer.js';
import type { ScanResult, WatcherTickSummary, DetectedIssue } from './types.js';
import { githubRequest } from '../lib/github.js';
import type { Octokit } from '@octokit/rest';

type PullRequestSummary = { number: number };

// ── Daemon state ──────────────────────────────────────────────────────────────

let consecutiveIdleTicks = 0;
let running              = false;

// ── Public entry point ────────────────────────────────────────────────────────

export async function startDaemon(opts: {
  repo:      string;
  domain?:   string;
  interval?: string;
}): Promise<void> {
  const config = await loadConfig();
  const [owner, name] = opts.repo.split('/');

  if (!owner || !name) {
    console.error(chalk.red(`Invalid repo slug "${opts.repo}" — expected owner/name`));
    process.exit(1);
  }

  const intervalSeconds = opts.interval ? parseInt(opts.interval, 10) : WATCHER_POLL_INTERVAL_SECONDS;
  const activePacks     = resolveActivePacks(config, opts.domain);

  console.log(chalk.cyan(`\n  vigilant watching ${chalk.bold(opts.repo)}`));
  console.log(chalk.dim(`  Domains : ${activePacks.map(p => p.name).join(', ')}`));
  console.log(chalk.dim(`  Interval: ${intervalSeconds}s`));
  console.log(chalk.dim(`  Press Ctrl+C to stop\n`));

  // Resume any interrupted sessions from a previous run
  await resumeInterruptedSessions();

  running = true;

  // Graceful shutdown
  const shutdown = () => {
    running = false;
    console.log(chalk.yellow('\n  vigilant stopped.\n'));
    process.exit(0);
  };
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);

  // Main tick loop
  while (running) {
    const tickStart = Date.now();

    try {
      const summary = await runTick({ owner, repo: name, activePacks, config });
      logTickSummary(summary);

      if (summary.totalIssuesFound === 0) {
        consecutiveIdleTicks++;
        if (consecutiveIdleTicks >= LEARNER_IDLE_TICKS_TRIGGER) {
          debug(`${consecutiveIdleTicks} idle ticks — triggering learner (Phase 6 stub)`, 'daemon');
          consecutiveIdleTicks = 0;
        }
      } else {
        consecutiveIdleTicks = 0;
      }
    } catch (err) {
      logError('Tick failed', 'daemon', err as Record<string, unknown>);
    }

    const elapsed    = (Date.now() - tickStart) / 1000;
    const waitMs     = Math.max(0, intervalSeconds - elapsed) * 1000;
    await sleep(waitMs);
  }
}

// ── Single tick ───────────────────────────────────────────────────────────────

async function runTick(params: {
  owner:       string;
  repo:        string;
  activePacks: import('../agent/domain-context.js').DomainPack[];
  config:      import('../config/types.js').VigilantConfig;
}): Promise<WatcherTickSummary> {
  const { owner, repo, activePacks, config } = params;
  const tickStart = new Date().toISOString();
  const db        = getStateDb();

  // ── Load ETags from DB ────────────────────────────────────────────────────
  const getEtag = (scanner: string): string | null =>
    getWatcherState(owner, repo, scanner)?.lastEtag ?? null;

  const saveEtag = (scanner: string, etag?: string): void => {
    if (!etag) return;
    upsertWatcherState({
      repoOwner:     owner,
      repoName:      repo,
      scannerName:   scanner,
      lastEtag:      etag,
      lastCheckedAt: new Date().toISOString(),
    });
  };

  // ── Run all scanners in parallel ─────────────────────────────────────────
  const [prResult, commitResult, ciResult, depResult, patternResult] =
    (await Promise.allSettled([
      scanPRs({ owner, repo, activePacks, lastEtag: getEtag('pr-scanner') }),
      scanCommits({ owner, repo, activePacks, lastEtag: getEtag('commit-scanner') }),
      scanCI({ owner, repo, activePacks, lastEtag: getEtag('ci-scanner') }),
      scanDependencies({ owner, repo, activePacks }),
      scanPatterns({ owner, repo, activePacks }),
    ])).map((r, i): ScanResult => {
      const names = ['pr-scanner', 'commit-scanner', 'ci-scanner', 'dep-scanner', 'pattern-scanner'];
      if (r.status === 'fulfilled') return r.value;
      warn(`Scanner ${names[i]} failed`, 'daemon', r.reason as Record<string, unknown>);
      return { scanner: names[i]!, issues: [] };
    });

  // Save ETags
  saveEtag('pr-scanner',      prResult.newEtag);
  saveEtag('commit-scanner',  commitResult.newEtag);
  saveEtag('ci-scanner',      ciResult.newEtag);

  // ── Collect open PR numbers for tool observer ─────────────────────────────
  let openPRNumbers: number[] = [];
  try {
    const prs = await githubRequest(
      (octokit: Octokit) =>
        octokit.request('GET /repos/{owner}/{repo}/pulls', {
          owner,
          repo,
          state:    'open',
          per_page: 50,
        }).then(r => r.data),
      'daemon',
    ) as PullRequestSummary[];
    openPRNumbers = prs.map(p => p.number);
  } catch (err) {
    warn('Could not fetch open PR list for tool observer', 'daemon', err as Record<string, unknown>);
  }

  const toolObserverResults = await observeAllOpenPRs({ owner, repo, prNumbers: openPRNumbers });

  // ── Collect and deduplicate all issues ────────────────────────────────────
  const allScanResults  = [prResult, commitResult, ciResult, depResult, patternResult];
  const allIssues       = allScanResults.flatMap(r => r.issues);
  const notModifiedCount = allScanResults.filter(r => r.notModified).length;

  let newSessionsStarted  = 0;
  let deduplicatedIssues  = 0;

  for (const issue of allIssues) {
    // Deduplicate: skip if an active session already exists for this exact issue
    if (activeSessionExists(issue.repoOwner, issue.repoName, issue.issueType, issue.sourceRef)) {
      deduplicatedIssues++;
      debug(`Deduplicated: ${issue.issueType} @ ${issue.sourceRef}`, 'daemon');
      continue;
    }

    // Attach any tool findings that came from the same PR
    const prNum = extractPRNumber(issue.sourceRef);
    const relevantToolFindings = prNum
      ? toolObserverResults.find(r => r.prNumber === prNum)?.findings ?? []
      : [];

    // Fire-and-forget: agent session is fully async, errors caught here
    startAgentSession(issue, activePacks, config, relevantToolFindings)
      .then(() => { /* Phase 3: session continues asynchronously */ })
      .catch(err => logError(`Agent session failed for ${issue.issueType}`, 'daemon', err));

    newSessionsStarted++;
    info(`New issue detected: ${issue.issueType} (${issue.severity}) @ ${issue.sourceRef}`, 'daemon');
  }

  const tickEnd = new Date().toISOString();

  return {
    repo:                 `${owner}/${repo}`,
    domain:               activePacks.map(p => p.id).join(','),
    tickStartedAt:        tickStart,
    tickCompletedAt:      tickEnd,
    scanResults:          allScanResults,
    totalIssuesFound:     allIssues.length,
    newSessionsStarted,
    deduplicatedIssues,
    notModifiedResponses: notModifiedCount,
    toolObserverResults,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resumeInterruptedSessions(): Promise<void> {
  // Only auto-resume `investigating` sessions.
  // Other stages (planning, executing, self_reviewing, etc.) require their own
  // phase handlers which are not yet implemented — they are left for later phases.
  const sessions = listSessionsByStage(STAGE.INVESTIGATING);
  for (const session of sessions) {
    info(`Resuming interrupted session ${session.sessionId} (stage: investigating)`, 'daemon');
    resumeSession(session.sessionId).catch(err =>
      logError(`Failed to resume session ${session.sessionId}`, 'daemon', err),
    );
  }
}

function logTickSummary(summary: WatcherTickSummary): void {
  const issueCount  = summary.totalIssuesFound;
  const statusLine  = issueCount === 0
    ? chalk.dim('  ✓ No new issues')
    : chalk.yellow(`  ⚑ ${issueCount} issue(s) found, ${summary.newSessionsStarted} new session(s) started`);

  const nmLine = summary.notModifiedResponses > 0
    ? chalk.dim(` [${summary.notModifiedResponses} cached]`)
    : '';

  console.log(`${statusLine}${nmLine}`);
}

/** Extract PR number from a sourceRef like "pr:42" or "ci:run:job". */
function extractPRNumber(sourceRef: string): number | null {
  const match = /^pr:(\d+)/.exec(sourceRef);
  return match ? parseInt(match[1]!, 10) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
