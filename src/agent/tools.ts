// src/agent/tools.ts
// Builds the tool set passed to every neurolink.generate() call.
// Each execute() updates session.dataCollected and persists via saveSession.

import { z }                    from 'zod';
import type { Tool }            from 'ai';
import { githubRequest }        from '../lib/github.js';
import { searchDocuments }      from '../db/queries/knowledge.js';
import { saveSession }          from '../db/queries/sessions.js';
import type { IssueSession }    from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentTool = Tool<any, any>;

/**
 * Build the full tool record for the agent investigation loop.
 * All execute functions close over `session` and persist state on every call.
 */
export function buildAgentTools(session: IssueSession): Record<string, AgentTool> {
  const owner = session.repoOwner;
  const repo  = session.repoName;

  function persist(key: string, value: unknown): void {
    session.dataCollected[key] = value;
    saveSession(session);
  }

  return {

    getCurrentTime: {
      description: 'Returns the current UTC timestamp. Called automatically on the first step.',
      parameters:  z.object({}),
      execute:     async () => {
        const result = { utc: new Date().toISOString() };
        persist('startTime', result.utc);
        return result;
      },
    } as unknown as AgentTool,

    sequentialThinking: {
      description: 'Breaks the investigation goal into ordered sub-steps and returns a step list. Call this early to plan your approach.',
      parameters: z.object({
        goal:  z.string().describe('One-sentence investigation goal'),
        steps: z.array(z.string()).describe('Ordered list of actions to take'),
      }),
      execute: async (args: { goal: string; steps: string[] }) => {
        const result = { goal: args.goal, steps: args.steps };
        persist('investigationPlan', result);
        return result;
      },
    } as unknown as AgentTool,

    readFile: {
      description: 'Reads the raw content of a file in the repository at HEAD.',
      parameters: z.object({
        path: z.string().describe('Repo-relative file path, e.g. "src/payment/checkout.ts"'),
      }),
      execute: async (args: { path: string }) => {
        try {
          const data = await githubRequest(
            (octokit) => octokit.repos.getContent({ owner, repo, path: args.path }).then(r => r.data),
            'tools.readFile',
          );
          if (Array.isArray(data) || data.type !== 'file') {
            return { error: `${args.path} is a directory, not a file` };
          }
          const content = Buffer.from(data.content, 'base64').toString('utf8');
          const key     = `file_${args.path.replace(/\W/g, '_')}`;
          persist(key, { path: args.path, size: data.size, content: content.slice(0, 8000) });
          return { path: args.path, content: content.slice(0, 8000), truncated: content.length > 8000 };
        } catch (err) {
          return { error: String(err) };
        }
      },
    } as unknown as AgentTool,

    searchCode: {
      description: 'Searches the repository code using a GitHub code search query. Returns matching file paths and snippets.',
      parameters: z.object({
        query: z.string().describe('GitHub code search query, e.g. "createPayment NOT idempotencyKey"'),
        limit: z.number().optional().default(10),
      }),
      execute: async (args: { query: string; limit?: number }) => {
        try {
          const data = await githubRequest(
            (octokit) => octokit.search.code({
              q:        `${args.query} repo:${owner}/${repo}`,
              per_page: Math.min(args.limit ?? 10, 20),
            }).then(r => r.data),
            'tools.searchCode',
          );
          const hits = data.items.map(item => ({
            path:    item.path,
            url:     item.html_url,
            snippet: (item as Record<string, unknown>)['text_matches']
              ? ((item as Record<string, unknown>)['text_matches'] as Array<{ fragment: string }>)[0]?.fragment
              : undefined,
          }));
          persist(`search_${args.query.slice(0, 40).replace(/\W/g, '_')}`, hits);
          return { totalCount: data.total_count, hits };
        } catch (err) {
          return { error: String(err) };
        }
      },
    } as unknown as AgentTool,

    ragSearch: {
      description: 'Searches the vigilant knowledge base for past fixes, team decisions, or runbooks relevant to this issue.',
      parameters: z.object({
        query: z.string().describe('Natural language query about the issue or fix pattern'),
      }),
      execute: async (args: { query: string }) => {
        const scope = `repo:${owner}/${repo}`;
        const docs  = searchDocuments({ scope, domain: session.domain, query: args.query, limit: 5 });
        const hits  = docs.map(d => ({ title: d.title, summary: d.content.slice(0, 400), confidence: d.confidence }));
        persist(`rag_${args.query.slice(0, 30).replace(/\W/g, '_')}`, hits);
        return { hits };
      },
    } as unknown as AgentTool,

    readPRDiff: {
      description: 'Reads the diff of a specific pull request. Useful when the issue was introduced by a recent PR.',
      parameters: z.object({
        prNumber: z.number().describe('Pull request number'),
      }),
      execute: async (args: { prNumber: number }) => {
        try {
          const diff = await githubRequest(
            (octokit) => octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
              owner,
              repo,
              pull_number: args.prNumber,
              mediaType: { format: 'diff' },
            }).then(r => String(r.data).slice(0, 10000)),
            'tools.readPRDiff',
          );
          persist(`pr_diff_${args.prNumber}`, diff.slice(0, 1000));
          return { prNumber: args.prNumber, diff: diff.slice(0, 10000), truncated: diff.length > 10000 };
        } catch (err) {
          return { error: String(err) };
        }
      },
    } as unknown as AgentTool,

    readGitHistory: {
      description: 'Reads the recent git commit history for a specific file path to understand when and why it changed.',
      parameters: z.object({
        path:  z.string().describe('Repo-relative file path'),
        limit: z.number().optional().default(10),
      }),
      execute: async (args: { path: string; limit?: number }) => {
        try {
          const commits = await githubRequest(
            (octokit) => octokit.repos.listCommits({
              owner,
              repo,
              path: args.path,
              per_page: Math.min(args.limit ?? 10, 20),
            }).then(r => r.data),
            'tools.readGitHistory',
          );
          const history = commits.map(c => ({
            sha:     c.sha.slice(0, 8),
            message: c.commit.message.split('\n')[0],
            author:  c.commit.author?.name,
            date:    c.commit.author?.date,
          }));
          persist(`git_history_${args.path.replace(/\W/g, '_')}`, history);
          return { path: args.path, history };
        } catch (err) {
          return { error: String(err) };
        }
      },
    } as unknown as AgentTool,

    readTeamDecisions: {
      description: 'Reads team ADRs, runbooks, or past decisions from the knowledge base. Use before proposing a fix strategy.',
      parameters: z.object({
        topic: z.string().describe('Topic or decision area, e.g. "payment retry strategy" or "error handling conventions"'),
      }),
      execute: async (args: { topic: string }) => {
        const scope = `repo:${owner}/${repo}`;
        const docs  = [
          ...searchDocuments({ scope,         domain: session.domain, query: args.topic, limit: 3 }),
          ...searchDocuments({ scope: 'global', domain: session.domain, query: args.topic, limit: 3 }),
        ];
        const decisions = docs.map(d => ({
          title:      d.title,
          content:    d.content.slice(0, 600),
          sourceType: d.sourceType,
        }));
        persist(`decisions_${args.topic.slice(0, 30).replace(/\W/g, '_')}`, decisions);
        return { topic: args.topic, decisions };
      },
    } as unknown as AgentTool,

  };
}
