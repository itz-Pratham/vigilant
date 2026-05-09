// src/learner/githubResearcher.ts
// Searches GitHub for merged PRs and security advisories relevant to a topic.

import { NeuroLink }                      from '@juspay/neurolink';
import { githubRequest }                  from '../lib/github.js';
import type { LearningTopic, ResearchDocument } from './types.js';
import type { Octokit }                   from '@octokit/rest';

const MAX_PRS      = 5;
const MAX_ADVISORY = 3;

// ── PR researcher ──────────────────────────────────────────────────────────────

/**
 * Searches GitHub for merged PRs related to the topic.
 * Summarises each PR title + body with NeuroLink and returns ResearchDocuments.
 */
export async function researchGitHubPRs(
  neurolink: NeuroLink,
  topic:     LearningTopic,
): Promise<ResearchDocument[]> {
  type SearchItem = { title: string; html_url: string; body: string | null };

  let items: SearchItem[];
  try {
    const q = `${topic.topic} is:pr is:merged language:TypeScript`;
    const data = await githubRequest(
      (octokit: Octokit) =>
        octokit.search.issuesAndPullRequests({
          q,
          sort:     'reactions',
          order:    'desc',
          per_page: MAX_PRS,
        }).then(r => r.data),
      'learner',
    ) as { items: SearchItem[] };
    items = data.items ?? [];
  } catch {
    return [];
  }

  if (items.length === 0) return [];

  const docs: ResearchDocument[] = [];

  for (const pr of items) {
    const body = (pr.body ?? 'No description').slice(0, 2000);
    try {
      const result = await neurolink.generate({
        input: {
          text: `Summarise this GitHub pull request in under 350 words. Focus on the problem it fixed and the code pattern used.\n\nTitle: ${pr.title}\nURL: ${pr.html_url}\nDescription:\n${body}\n\nReturn clean markdown.`,
        },
        disableTools: true,
      });

      docs.push({
        title:      pr.title,
        url:        pr.html_url,
        content:    result.content.slice(0, 4000),
        domain:     topic.domain,
        sourceType: 'github_prs',
        tags:       [topic.topic, topic.domain, 'github_pr'],
      });
    } catch {
      /* generation failure is non-fatal — skip this PR */
    }
  }

  return docs;
}

// ── Advisory researcher ────────────────────────────────────────────────────────

/** GitHub advisory ecosystem filter per domain. */
const DOMAIN_ECOSYSTEM: Record<string, string> = {
  payments:    'npm',
  security:    'npm',
  reliability: 'npm',
  compliance:  'npm',
};

/**
 * Searches GitHub Global Security Advisories for vulnerabilities related to the topic.
 * Uses ecosystem + severity filters rather than free-text search.
 */
export async function researchGitHubAdvisories(
  neurolink: NeuroLink,
  topic:     LearningTopic,
): Promise<ResearchDocument[]> {
  type Advisory = {
    ghsa_id:     string;
    summary:     string;
    description: string | null;
    severity:    string | null;
    html_url:    string;
  };

  let advisories: Advisory[];
  try {
    advisories = await githubRequest(
      (octokit: Octokit) =>
        (octokit.securityAdvisories as unknown as {
          listGlobalAdvisories(p: Record<string, unknown>): Promise<{ data: Advisory[] }>;
        }).listGlobalAdvisories({
          ecosystem: DOMAIN_ECOSYSTEM[topic.domain] ?? 'npm',
          severity:  'high',
          per_page:  MAX_ADVISORY,
        }).then(r => r.data),
      'learner',
    ) as Advisory[];
  } catch {
    return [];
  }

  if (advisories.length === 0) return [];

  const summaryText = advisories.map(a =>
    `GHSA: ${a.ghsa_id}\nSeverity: ${a.severity ?? 'unknown'}\nSummary: ${a.summary}\n${(a.description ?? '').slice(0, 800)}`,
  ).join('\n\n---\n\n');

  let content: string;
  try {
    const result = await neurolink.generate({
      input: {
        text: `You are a security educator. Summarise these GitHub Security Advisories for ${topic.domain} developers. For each, explain what causes the vulnerability and how to fix it in TypeScript/Node.js.\n\n${summaryText}\n\nReturn clean markdown under 600 words.`,
      },
      disableTools: true,
    });
    content = result.content.slice(0, 4000);
  } catch {
    return [];
  }

  return [{
    title:      `Security advisories: ${topic.topic}`,
    url:        `https://github.com/advisories?query=ecosystem%3Anpm+severity%3Ahigh`,
    content,
    domain:     topic.domain,
    sourceType: 'github_advisories',
    tags:       [topic.domain, 'advisory', 'security', 'npm'],
  }];
}
