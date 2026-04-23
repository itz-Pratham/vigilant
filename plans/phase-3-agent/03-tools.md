# Phase 3 — Agent Tools

**File:** `src/agent/tools.ts`

## Objective

Define all seven tools available to the agent during investigation. Each tool is a function the agent can call autonomously. Tools are defined in the NeuroLink tool format and passed to `neurolink.generate()` on every iteration. Two new tools (`readGitHistory`, `readTeamDecisions`) power the knowledge stack's git history and team decision sources.

---

## Tool Definitions

```typescript
import { githubRequest } from '@/lib/github';
import { searchDocuments } from '@/db/queries/knowledge';
import { info, warn } from '@/lib/logger';
import type { IssueSession, AgentToolCall, AgentToolResult } from './types';

/**
 * Returns all tool definitions for a session.
 * Tools are scoped to the session's repo — agents cannot read other repos.
 */
export function getAgentTools(session: IssueSession) {
  const { repoOwner: owner, repoName: repo } = session;

  return [
    {
      name: 'readFile',
      description: `Read the content of a file from the repository ${owner}/${repo}. Use this to inspect the actual code where the issue was detected.`,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repository-relative file path, e.g. "src/checkout/payment.ts"' },
          ref:  { type: 'string', description: 'Git ref (branch, commit SHA). Default: the repo default branch.' },
        },
        required: ['path'],
      },
    },
    {
      name: 'searchCode',
      description: `Search the codebase of ${owner}/${repo} for a code pattern using the GitHub Search API.`,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query. Example: "createPayment idempotencyKey". Use GitHub search syntax.' },
        },
        required: ['query'],
      },
    },
    {
      name: 'ragSearch',
      description: 'Search the vigilant knowledge base for best practices, known patterns, and learned information relevant to this issue type.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language query, e.g. "idempotency key payment API best practice"' },
        },
        required: ['query'],
      },
    },
    {
      name: 'readPRDiff',
      description: `Read the full diff of a pull request in ${owner}/${repo}. Use this when the issue was detected in a specific PR.`,
      parameters: {
        type: 'object',
        properties: {
          pullNumber: { type: 'number', description: 'The PR number, e.g. 47' },
        },
        required: ['pullNumber'],
      },
    },
    {
      name: 'searchWeb',
      description: 'Search the web for information about this issue type, best practices, or CVEs. Use for information not in the knowledge base.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Web search query' },
        },
        required: ['query'],
      },
    },
    {
      name: 'readGitHistory',
      description: `Read the recent git history for a file or the entire repo in ${owner}/${repo}. Use this to understand how your team has handled this type of issue before, what patterns they prefer, and whether this is a regression.`,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Optional repository-relative file path to filter commits by. Omit for repo-wide history.',
          },
          limit: {
            type: 'number',
            description: 'Number of recent commits to fetch. Default: 20, max: 50.',
          },
        },
        required: [],
      },
    },
    {
      name: 'readTeamDecisions',
      description: `Read team decision documents from ${owner}/${repo}: decision.md, adr/ directory, and docs/ directory. Use this to understand explicit team decisions about patterns, architecture, and conventions before concluding what the "correct" fix is.`,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Optional specific file or directory to read. Omit to auto-discover decision docs.',
          },
        },
        required: [],
      },
    },
    {
      name: 'getCurrentTime',
      description: 'Get the current UTC timestamp. Always called as step 0.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'sequentialThinking',
      description: 'Think step by step about the investigation. Always called as step 1 before using any other tools.',
      parameters: {
        type: 'object',
        properties: {
          thoughts: { type: 'string', description: 'Your step-by-step reasoning about the issue' },
        },
        required: ['thoughts'],
      },
    },
  ];
}

// ── Tool Execution ────────────────────────────────────────────────────

export async function executeToolCall(
  toolCall: AgentToolCall,
  session: IssueSession
): Promise<AgentToolResult> {
  info(`Tool call: ${toolCall.name}`, session.sessionId, toolCall.parameters);

  try {
    const result = await dispatchToolCall(toolCall, session);
    return { toolName: toolCall.name, success: true, result };
  } catch (err: unknown) {
    warn(`Tool call failed: ${toolCall.name}`, session.sessionId, { error: (err as Error).message });
    return { toolName: toolCall.name, success: false, result: null, error: (err as Error).message };
  }
}

async function dispatchToolCall(toolCall: AgentToolCall, session: IssueSession): Promise<unknown> {
  const { repoOwner: owner, repoName: repo, sessionId } = session;

  switch (toolCall.name) {
    case 'getCurrentTime':
      return { utc: new Date().toISOString() };

    case 'sequentialThinking':
      return { acknowledged: true, thoughts: toolCall.parameters.thoughts };

    case 'readFile': {
      const path = toolCall.parameters.path as string;
      const ref = toolCall.parameters.ref as string | undefined;
      const response = await githubRequest(
        octokit => octokit.rest.repos.getContent({ owner, repo, path, ref }), sessionId
      );
      const data = response.data;
      if (!('content' in data)) throw new Error(`${path} is a directory, not a file`);
      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      const lines = content.split('\n');
      return {
        path, content, lines: lines.length, sha: data.sha,
        preview: lines.slice(0, 100).map((l, i) => `${String(i + 1).padStart(4)}: ${l}`).join('\n'),
      };
    }

    case 'searchCode': {
      const query = `${toolCall.parameters.query as string} repo:${owner}/${repo}`;
      const response = await githubRequest(
        octokit => octokit.rest.search.code({ q: query, per_page: 10 }), sessionId
      );
      return response.data.items.map(item => ({
        path: item.path,
        htmlUrl: item.html_url,
        textMatches: item.text_matches?.map(m => m.fragment) ?? [],
      }));
    }

    case 'ragSearch': {
      const query = toolCall.parameters.query as string;
      const scope = `repo:${owner}/${repo}`;
      const docs = searchDocuments(query, scope, session.domain);
      return docs.map(d => ({
        title: d.title, topic: d.topic,
        keyPoints: d.keyPoints, sourceUrl: d.sourceUrl, learnedAt: d.learnedAt,
      }));
    }

    case 'readPRDiff': {
      const pullNumber = toolCall.parameters.pullNumber as number;
      const [pr, files] = await Promise.all([
        githubRequest(o => o.rest.pulls.get({ owner, repo, pull_number: pullNumber }), sessionId),
        githubRequest(o => o.rest.pulls.listFiles({ owner, repo, pull_number: pullNumber, per_page: 30 }), sessionId),
      ]);
      return {
        title: pr.data.title,
        author: pr.data.user?.login,
        state: pr.data.state,
        filesChanged: files.data.map(f => ({
          path: f.filename, status: f.status,
          additions: f.additions, deletions: f.deletions,
          patch: f.patch?.substring(0, 2000) ?? '',
        })),
      };
    }

    case 'readGitHistory': {
      const path = toolCall.parameters.path as string | undefined;
      const limit = Math.min((toolCall.parameters.limit as number | undefined) ?? 20, 50);
      const params: Record<string, unknown> = { owner, repo, per_page: limit };
      if (path) params.path = path;
      const response = await githubRequest(
        octokit => octokit.rest.repos.listCommits(params as Parameters<typeof octokit.rest.repos.listCommits>[0]),
        sessionId
      );
      return response.data.map(c => ({
        sha:     c.sha.slice(0, 7),
        message: c.commit.message.split('\n')[0],  // first line only
        author:  c.commit.author?.name,
        date:    c.commit.author?.date,
        url:     c.html_url,
      }));
    }

    case 'readTeamDecisions': {
      const targetPath = toolCall.parameters.path as string | undefined;
      const DECISION_PATHS = targetPath
        ? [targetPath]
        : ['decision.md', 'DECISION.md', 'decisions.md', 'adr', 'docs/decisions', 'docs/adr'];

      const results: Array<{ path: string; content: string }> = [];

      for (const p of DECISION_PATHS) {
        try {
          const response = await githubRequest(
            octokit => octokit.rest.repos.getContent({ owner, repo, path: p }), sessionId
          );
          const data = response.data;
          if (Array.isArray(data)) {
            // Directory — list files
            results.push({ path: p, content: `Directory listing: ${data.map(f => f.name).join(', ')}` });
          } else if ('content' in data) {
            const content = Buffer.from(data.content, 'base64').toString('utf-8');
            results.push({ path: p, content: content.substring(0, 3000) });  // cap at 3KB
          }
        } catch {
          // File not found — silently skip
        }
      }

      return results.length > 0
        ? results
        : { note: 'No decision documents found. Team may not use this convention.' };
    }

    case 'searchWeb':
      return { note: 'Web search results will be provided by the AI provider directly.' };

    default:
      throw new Error(`Unknown tool: ${(toolCall as { name: string }).name}`);
  }
}
```

  return [
    {
      name: 'readFile',
      description: `Read the content of a file from the repository ${owner}/${repo}. Use this to inspect the actual code where the issue was detected.`,
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Repository-relative file path, e.g. "src/checkout/payment.ts"',
          },
          ref: {
            type: 'string',
            description: 'Git ref (branch, commit SHA). Default: the repo default branch.',
          },
        },
        required: ['path'],
      },
    },
    {
      name: 'searchCode',
      description: `Search the codebase of ${owner}/${repo} for a code pattern using the GitHub Search API.`,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query. Example: "createPayment idempotencyKey". Use GitHub search syntax.',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'ragSearch',
      description: 'Search the vigilant knowledge base for best practices, known patterns, and learned information relevant to this issue type.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural language query, e.g. "idempotency key payment API best practice"',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'readPRDiff',
      description: `Read the full diff of a pull request in ${owner}/${repo}. Use this when the issue was detected in a specific PR.`,
      parameters: {
        type: 'object',
        properties: {
          pullNumber: {
            type: 'number',
            description: 'The PR number, e.g. 47',
          },
        },
        required: ['pullNumber'],
      },
    },
    {
      name: 'searchWeb',
      description: 'Search the web for information about this issue type, best practices, or CVEs. Use for information not in the knowledge base.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Web search query',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'getCurrentTime',
      description: 'Get the current UTC timestamp. Always called as step 0.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'sequentialThinking',
      description: 'Think step by step about the investigation. Always called as step 1 before using any other tools.',
      parameters: {
        type: 'object',
        properties: {
          thoughts: {
            type: 'string',
            description: 'Your step-by-step reasoning about the issue',
          },
        },
        required: ['thoughts'],
      },
    },
  ];
}

// ── Tool Execution ────────────────────────────────────────────────────

export async function executeToolCall(
  toolCall: AgentToolCall,
  session: IssueSession
): Promise<AgentToolResult> {
  info(`Tool call: ${toolCall.name}`, session.sessionId, toolCall.parameters);

  try {
    const result = await dispatchToolCall(toolCall, session);
    return { toolName: toolCall.name, success: true, result };
  } catch (err: unknown) {
    warn(`Tool call failed: ${toolCall.name}`, session.sessionId, {
      error: (err as Error).message,
    });
    return {
      toolName: toolCall.name,
      success: false,
      result: null,
      error: (err as Error).message,
    };
  }
}

async function dispatchToolCall(
  toolCall: AgentToolCall,
  session: IssueSession
): Promise<unknown> {
  const { repoOwner: owner, repoName: repo, sessionId } = session;

  switch (toolCall.name) {
    case 'getCurrentTime':
      return { utc: new Date().toISOString() };

    case 'sequentialThinking':
      // Just returns the thoughts — the value is in the model doing the thinking
      return { acknowledged: true, thoughts: toolCall.parameters.thoughts };

    case 'readFile': {
      const path = toolCall.parameters.path as string;
      const ref = toolCall.parameters.ref as string | undefined;
      const response = await githubRequest(
        octokit => octokit.rest.repos.getContent({ owner, repo, path, ref }),
        sessionId
      );
      const data = response.data;
      if (!('content' in data)) throw new Error(`${path} is a directory, not a file`);
      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      const lines = content.split('\n');
      return {
        path,
        content,
        lines: lines.length,
        sha: data.sha,
        // Include a line-numbered preview for the first 100 lines
        preview: lines.slice(0, 100).map((l, i) => `${String(i + 1).padStart(4)}: ${l}`).join('\n'),
      };
    }

    case 'searchCode': {
      const query = `${toolCall.parameters.query as string} repo:${owner}/${repo}`;
      const response = await githubRequest(
        octokit => octokit.rest.search.code({ q: query, per_page: 10 }),
        sessionId
      );
      return response.data.items.map(item => ({
        path: item.path,
        htmlUrl: item.html_url,
        textMatches: item.text_matches?.map(m => m.fragment) ?? [],
      }));
    }

    case 'ragSearch': {
      const query = toolCall.parameters.query as string;
      const scope = `repo:${owner}/${repo}`;
      const docs = searchDocuments(query, scope, session.domain);
      return docs.map(d => ({
        title: d.title,
        topic: d.topic,
        keyPoints: d.keyPoints,
        sourceUrl: d.sourceUrl,
        learnedAt: d.learnedAt,
      }));
    }

    case 'readPRDiff': {
      const pullNumber = toolCall.parameters.pullNumber as number;
      const response = await githubRequest(
        octokit => octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber }),
        sessionId
      );
      const filesResponse = await githubRequest(
        octokit => octokit.rest.pulls.listFiles({ owner, repo, pull_number: pullNumber, per_page: 30 }),
        sessionId
      );
      return {
        title: response.data.title,
        author: response.data.user?.login,
        state: response.data.state,
        filesChanged: filesResponse.data.map(f => ({
          path: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch?.substring(0, 2000) ?? '',  // truncate large diffs
        })),
      };
    }

    case 'searchWeb': {
      // NeuroLink has a built-in web search tool — delegate to it
      // This is called separately via a NeuroLink AutoResearch-style call
      // For now, return a placeholder that the model can work with
      return { note: 'Web search results will be provided by the AI provider directly.' };
    }

    default:
      throw new Error(`Unknown tool: ${(toolCall as { name: string }).name}`);
  }
}
```
