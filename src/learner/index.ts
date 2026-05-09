// src/learner/index.ts
// Phase 6 Learner — runs one research job per call, fires from idle watcher tick.

import chalk                            from 'chalk';
import { NeuroLink }                    from '@juspay/neurolink';
import { getStateDb }                   from '../db/index.js';
import { seedTopics, getNextTopic, claimTopic } from './topicQueue.js';
import { researchGitHubPRs, researchGitHubAdvisories } from './githubResearcher.js';
import { researchEngBlog, researchCVE } from './webResearcher.js';
import { storeResearchResults }         from './ragStore.js';
import { info, warn }                   from '../lib/logger.js';
import type { LearnerOptions, ResearchDocument, ResearchResult } from './types.js';

// ── Single-flight guard ───────────────────────────────────────────────────────

let _inFlight = false;

/** Returns true if a learner job is currently running. */
export function isLearnerInFlight(): boolean { return _inFlight; }

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Runs one research job: picks the next topic from the queue, dispatches to the
 * right researcher, stores results, and returns a ResearchResult summary.
 * Guarded by a single-flight lock — concurrent calls return early immediately.
 */
export async function runLearner(opts: LearnerOptions = {}): Promise<ResearchResult> {
  if (_inFlight) {
    return { topic: 'skipped', sourceType: 'github_prs', documents: [], durationMs: 0, itemsAdded: 0 };
  }

  _inFlight = true;
  const startMs = Date.now();

  try {
    const db = getStateDb();
    seedTopics(db);

    // Pick and claim topic atomically — claim before network to prevent overlap
    const topic = getNextTopic(db, opts.domain);
    if (!topic) {
      return { topic: 'none', sourceType: 'github_prs', documents: [], durationMs: 0, itemsAdded: 0 };
    }

    // Override topic text if caller specified one
    const effectiveTopic = opts.topicOverride
      ? { ...topic, topic: opts.topicOverride }
      : topic;

    // Claim in DB before going async to prevent another tick from picking the same topic
    claimTopic(db, topic.id);

    info(`Learner starting: "${effectiveTopic.topic}" (${effectiveTopic.sourceType}) [${effectiveTopic.domain}]`, 'learner');

    const neurolink = opts.geminiApiKey
      ? new NeuroLink({ credentials: { googleAiStudio: { apiKey: opts.geminiApiKey } } })
      : new NeuroLink();
    let docs: ResearchDocument[] = [];

    switch (effectiveTopic.sourceType) {
      case 'github_prs':
        docs = await researchGitHubPRs(neurolink, effectiveTopic);
        break;
      case 'github_advisories':
        docs = await researchGitHubAdvisories(neurolink, effectiveTopic);
        break;
      case 'engineering_blog':
        docs = await researchEngBlog(neurolink, effectiveTopic);
        break;
      case 'cve_database':
        docs = await researchCVE(neurolink, effectiveTopic);
        break;
    }

    const scope     = opts.scope ?? 'global';
    const itemsAdded = storeResearchResults(docs, scope, effectiveTopic.topic);

    info(`Learner done: ${itemsAdded}/${docs.length} doc(s) added [${effectiveTopic.topic}]`, 'learner');

    return {
      topic:      effectiveTopic.topic,
      sourceType: effectiveTopic.sourceType,
      documents:  docs,
      durationMs: Date.now() - startMs,
      itemsAdded,
    };
  } catch (err) {
    warn('Learner job failed', 'learner', err as Record<string, unknown>);
    return { topic: 'error', sourceType: 'github_prs', documents: [], durationMs: Date.now() - startMs, itemsAdded: 0 };
  } finally {
    _inFlight = false;
  }
}

// ── CLI entry point ───────────────────────────────────────────────────────────

/**
 * CLI entry point for `vigilant learn`.
 * Accepts explicit topic/domain/repo options and prints a human-readable summary.
 */
export async function runLearnJob(opts: { topic?: string; domain?: string; repo?: string }): Promise<void> {
  const { loadConfig } = await import('../config/index.js');
  const config = loadConfig();
  const scope = opts.repo ? `repo:${opts.repo}` : 'global';

  const result = await runLearner({
    topicOverride: opts.topic,
    domain:        opts.domain,
    scope,
    geminiApiKey:  config.geminiApiKey,
  });

  if (result.topic === 'skipped') {
    console.log(chalk.yellow('\n  Learner is already running — try again shortly.\n'));
    return;
  }
  if (result.topic === 'none') {
    console.log(chalk.yellow('\n  No topics in queue. Run `vigilant init` to seed the knowledge base.\n'));
    return;
  }

  if (result.itemsAdded === 0) {
    console.log(chalk.dim('\n  No new documents added (all URLs already in knowledge base)\n'));
  } else {
    console.log(chalk.green(`\n  ✓ Added ${result.itemsAdded} new document(s) to knowledge base`));
    console.log(chalk.dim(`    Topic:    ${result.topic}`));
    console.log(chalk.dim(`    Source:   ${result.sourceType}`));
    console.log(chalk.dim(`    Duration: ${(result.durationMs / 1000).toFixed(1)}s\n`));
  }
}

