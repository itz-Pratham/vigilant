# Phase 2 — Tool Observer

**File:** `src/watcher/tool-observer.ts`

## Objective

Read PR review comments from Snyk, CodeRabbit, Dependabot, and GitHub Security on open PRs. Returns `ToolObserverResult[]` for each PR. Falls back gracefully when no tools are present — callers treat empty findings as fallback mode, not an error.

---

## Bot Usernames

```typescript
// src/lib/constants.ts (add these)
export const TOOL_BOT_USERNAMES: Record<string, ExternalToolFinding['tool']> = {
  'snyk-bot':                        'snyk',
  'coderabbitai[bot]':               'coderabbit',
  'dependabot[bot]':                 'dependabot',
  'github-advanced-security[bot]':   'github_security',
};
```

---

## Implementation

```typescript
// src/watcher/tool-observer.ts

import { githubRequest } from '@/lib/github';
import { info, warn }    from '@/lib/logger';
import { TOOL_BOT_USERNAMES } from '@/lib/constants';
import type { ExternalToolFinding, ToolObserverResult } from './types';

/**
 * Reads PR review comments from known tool bots on a list of open PR numbers.
 * Returns one ToolObserverResult per PR. Empty findings = no tools present (fallback mode).
 */
export async function runToolObserver(
  owner: string,
  repo: string,
  openPrNumbers: number[],
): Promise<ToolObserverResult[]> {
  const results: ToolObserverResult[] = [];

  for (const prNumber of openPrNumbers) {
    try {
      const findings = await readPRToolComments(owner, repo, prNumber);
      results.push({
        prNumber,
        findings,
        toolsPresent: findings.length > 0,
      });
    } catch (err) {
      warn(`Tool Observer: failed to read comments on PR#${prNumber}: ${(err as Error).message}`, 'tool-observer');
      results.push({ prNumber, findings: [], toolsPresent: false });
    }
  }

  return results;
}

async function readPRToolComments(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<ExternalToolFinding[]> {
  // GitHub PR comments endpoint — reads issue-style comments (not review threads)
  const comments = await githubRequest('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
    owner, repo, issue_number: prNumber, per_page: 100,
  }) as Array<{ user?: { login?: string }; body?: string }>;

  const findings: ExternalToolFinding[] = [];

  for (const comment of comments) {
    const login = comment.user?.login ?? '';
    const tool = TOOL_BOT_USERNAMES[login];
    if (!tool || !comment.body) continue;

    findings.push({
      tool,
      comment: comment.body,
      severity: parseSeverity(comment.body),
      file:     parseFilePath(comment.body),
      line:     parseLineNumber(comment.body),
      prNumber,
    });
  }

  // Also check review comments (inline on diff)
  const reviewComments = await githubRequest('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
    owner, repo, pull_number: prNumber,
  }) as Array<{ user?: { login?: string }; body?: string }>;

  for (const review of reviewComments) {
    const login = review.user?.login ?? '';
    const tool = TOOL_BOT_USERNAMES[login];
    if (!tool || !review.body) continue;

    findings.push({ tool, comment: review.body, prNumber });
  }

  info(`Tool Observer: PR#${prNumber} — ${findings.length} tool findings`, 'tool-observer');
  return findings;
}

// ── Parsing helpers ───────────────────────────────────────────────────────

function parseSeverity(body: string): string | undefined {
  const match = body.match(/\b(critical|high|medium|low)\b/i);
  return match?.[1]?.toUpperCase();
}

function parseFilePath(body: string): string | undefined {
  // Match markdown code references like `src/checkout/payment.ts`
  const match = body.match(/`([a-zA-Z0-9_\-./]+\.(ts|js|tsx|jsx|py|go|java))`/);
  return match?.[1];
}

function parseLineNumber(body: string): number | undefined {
  const match = body.match(/line[:\s]+(\d+)/i);
  return match ? parseInt(match[1], 10) : undefined;
}
```

---

## Open PR Numbers Source

The Tool Observer needs a list of currently open PR numbers to scan. These come from the PR Scanner's last result (cached in the watcher tick loop — no extra API call needed):

```typescript
// In startWatcher tick:
const openPrNumbers = prScanResult.issues
  .filter(i => i.sourceRef.startsWith('PR#'))
  .map(i => parseInt(i.sourceRef.slice(3), 10))
  .filter((n, idx, arr) => arr.indexOf(n) === idx);  // deduplicate

const toolObserverResults = await runToolObserver(owner, repo, openPrNumbers);
```

---

## Fallback Detection

```typescript
// Caller logic — in startAgentSession or agent tool:
const toolFindings = toolObserverResults.find(r => r.prNumber === prNumber)?.findings ?? [];
const fallbackMode = toolFindings.length === 0;
// Pass toolFindings to agent as additional context (not instructions)
```

---

## Rate Limit Cost

- 2 API calls per open PR (issue comments + reviews)
- For 10 open PRs: 20 calls per tick
- Well within the 5000/hr budget even at 60s intervals
