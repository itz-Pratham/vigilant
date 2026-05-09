// src/mcp/index.ts
// Creates and starts the vigilant MCP server.

import { McpServer }                    from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport }         from '@modelcontextprotocol/sdk/server/stdio.js';
import express                          from 'express';
import { NeuroLink }                    from '@juspay/neurolink';
import {
  listKnownIssuesShape,
  analyzeSnippetShape,
  getDomainPatternShape,
  getSessionStatusShape,
  approvePlanShape,
  type ListKnownIssuesInput,
  type AnalyzeSnippetInput,
  type GetDomainPatternInput,
  type GetSessionStatusInput,
  type ApprovePlanInput,
} from './types.js';
import { handleListKnownIssues }  from './tools/listKnownIssues.js';
import { handleAnalyzeSnippet }   from './tools/analyzeSnippet.js';
import { handleGetDomainPattern } from './tools/getDomainPattern.js';
import { handleGetSessionStatus } from './tools/getSessionStatus.js';
import { handleApprovePlan }      from './tools/approvePlan.js';

// ── Server factory ────────────────────────────────────────────────────────────

/**
 * Creates a configured McpServer with all 5 vigilant tools registered.
 * Pass in a NeuroLink instance (used by analyze_snippet).
 */
export function createMCPServer(neurolink: NeuroLink): McpServer {
  const server = new McpServer({ name: 'vigilant', version: '1.0.0' });

  server.registerTool(
    'list_known_issues',
    {
      description: 'List active vigilant sessions for the watched repository. Excludes merged/closed/skipped by default.',
      inputSchema: listKnownIssuesShape,
    },
    (args) => {
      const input = args as ListKnownIssuesInput;
      return Promise.resolve(handleListKnownIssues({ ...input, limit: input.limit ?? 10 }));
    },
  );

  server.registerTool(
    'analyze_snippet',
    {
      description: 'Classify a code snippet against vigilant domain patterns and identify issues.',
      inputSchema: analyzeSnippetShape,
    },
    (args) => {
      const input = args as AnalyzeSnippetInput;
      return handleAnalyzeSnippet(neurolink, { ...input, language: input.language ?? 'typescript' });
    },
  );

  server.registerTool(
    'get_domain_pattern',
    {
      description: 'Get the full pattern description, code examples, and fix guide for a vigilant issue type.',
      inputSchema: getDomainPatternShape,
    },
    (args) => handleGetDomainPattern(args as GetDomainPatternInput),
  );

  server.registerTool(
    'get_session_status',
    {
      description: 'Get detailed status of a specific vigilant session by session ID.',
      inputSchema: getSessionStatusShape,
    },
    (args) => Promise.resolve(handleGetSessionStatus(args as GetSessionStatusInput)),
  );

  server.registerTool(
    'approve_plan',
    {
      description: 'Approve a vigilant Gate 1 plan. Advances session to execution. Daemon must be running separately.',
      inputSchema: approvePlanShape,
    },
    (args) => Promise.resolve(handleApprovePlan(args as ApprovePlanInput)),
  );

  return server;
}

// ── HTTP transport (for Cursor / Claude Code) ─────────────────────────────────

/**
 * Starts an Express HTTP server exposing the MCP server.
 * Uses a fresh StreamableHTTPServerTransport per request (stateless pattern).
 * Binds to 127.0.0.1 only — never exposed to the network by default.
 */
export function startHTTPServer(server: McpServer, port: number): Promise<void> {
  const app = express();
  app.use(express.json());

  // Health check — useful for verifying server is up
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', name: 'vigilant', port });
  });

  // MCP endpoint — fresh transport per request (stateless)
  app.post('/mcp', async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    await transport.close();
  });

  // SSE GET for clients that open a persistent SSE connection
  app.get('/mcp', async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });

  return new Promise((resolve) => {
    app.listen(port, '127.0.0.1', () => resolve());
  });
}

// ── Stdio transport (for Claude Desktop) ─────────────────────────────────────

/**
 * Starts the MCP server on stdio.
 * stdout is the MCP transport — do not write anything else to stdout after calling this.
 */
export async function startStdioServer(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
