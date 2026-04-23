# Phase 6 — GitHub Researcher

**File:** `src/learner/githubResearcher.ts`

## Objective

Search GitHub for high-quality merged PRs and security advisories related to a learning topic. Returns `ResearchDocument[]` ready to be stored in the knowledge base.

---

## Implementation

```typescript
// src/learner/githubResearcher.ts
import { Octokit }          from '@octokit/rest';
import { NeuroLink }        from '@juspay/neurolink';
import { ResearchDocument, LearningTopic } from './types.js';

const MAX_PRS_PER_RUN = 5;

/**
 * Searches GitHub for merged PRs matching the topic.
 * Uses NeuroLink to summarise each PR diff into a document.
 */
export async function searchMergedPRs(
  octokit:   Octokit,
  neurolink: NeuroLink,
  topic:     LearningTopic,
): Promise<ResearchDocument[]> {
  const query = `${topic.topic} is:pr is:merged label:fix language:TypeScript language:JavaScript`;

  const { data } = await octokit.search.issuesAndPullRequests({
    q:        query,
    sort:     'reactions',     // most-upvoted = most relevant
    order:    'desc',
    per_page: MAX_PRS_PER_RUN,
  });

  const docs: ResearchDocument[] = [];

  for (const pr of data.items) {
    const prUrl = pr.html_url;
    const body  = pr.body?.slice(0, 3000) ?? 'No description';

    // Summarise with NeuroLink
    const { text: summary } = await neurolink.generate({
      prompt: `Summarise this GitHub PR in under 400 words, focusing on the problem it fixed and the code pattern used to fix it.

Title: ${pr.title}
URL: ${prUrl}
Body:
${body}

Return a clean markdown summary.`,
      provider: 'google',
      model:    'gemini-2.0-flash',
    });

    docs.push({
      title:   pr.title,
      url:     prUrl,
      content: summary,
      domain:  topic.domain,
      tags:    [topic.topic, topic.domain, 'github_pr'],
    });
  }

  return docs;
}

/**
 * Fetches GitHub Security Advisories for domain-relevant packages.
 */
export async function searchAdvisories(
  octokit:   Octokit,
  neurolink: NeuroLink,
  topic:     LearningTopic,
): Promise<ResearchDocument[]> {
  // GitHub Advisory Database API (public, no auth needed)
  const url = `https://api.github.com/advisories?affects=${encodeURIComponent(topic.topic)}&per_page=5`;

  let advisories: any[] = [];
  try {
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept:        'application/vnd.github+json',
      },
    });
    advisories = resp.ok ? await resp.json() : [];
  } catch {
    return [];
  }

  const docs: ResearchDocument[] = [];

  for (const adv of advisories.slice(0, 3)) {
    const { text: summary } = await neurolink.generate({
      prompt: `Summarise this security advisory in under 300 words. Focus on what code pattern to avoid and how to fix it.

Advisory: ${adv.summary}
Severity: ${adv.severity}
Description: ${(adv.description ?? '').slice(0, 2000)}

Return clean markdown.`,
      provider: 'google',
      model:    'gemini-2.0-flash',
    });

    docs.push({
      title:   adv.summary ?? 'Security Advisory',
      url:     adv.html_url ?? `https://github.com/advisories/${adv.ghsa_id}`,
      content: summary,
      domain:  topic.domain,
      tags:    [topic.domain, 'security_advisory', 'github'],
    });
  }

  return docs;
}
```

---

## Rate Limit Awareness

| API Call | Limit | Budget used per run |
|---|---|---|
| `search/issues` | 30/min | 1 call |
| Advisory endpoint | 5000/hr | 1 call |
| NeuroLink generate | 15 RPM Gemini | 5–8 calls per run |

Learner runs at most once per `LEARNER_IDLE_TICKS_TRIGGER` ticks (default: 10 ticks = 50 min). Safe within all rate budgets.
