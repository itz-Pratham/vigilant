# Phase 7 — MCP Server Setup

**File:** `src/mcp/index.ts`

## Objective

Create and start the MCP HTTP server using `@modelcontextprotocol/sdk`. Register all five tools with their Zod schemas. Support both HTTP SSE transport (for Cursor) and stdio transport (for Claude Desktop).

---

## Implementation

```typescript
// src/mcp/index.ts
import { McpServer }              from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport }   from '@modelcontextprotocol/sdk/server/stdio.js';
import express                    from 'express';
import Database                   from 'better-sqlite3';
import { NeuroLink }              from '@juspay/neurolink';

import { ListKnownIssuesInput }  from './types.js';
import { AnalyzeSnippetInput }   from './types.js';
import { GetDomainPatternInput } from './types.js';
import { GetSessionStatusInput } from './types.js';
import { ApprovePlanInput }      from './types.js';

import { handleListKnownIssues }  from './tools/listKnownIssues.js';
import { handleAnalyzeSnippet }   from './tools/analyzeSnippet.js';
import { handleGetDomainPattern } from './tools/getDomainPattern.js';
import { handleGetSessionStatus } from './tools/getSessionStatus.js';
import { handleApprovePlan }      from './tools/approvePlan.js';

export function createMCPServer(
  db:        Database.Database,
  neurolink: NeuroLink,
): McpServer {
  const server = new McpServer({
    name:    'vigilant',
    version: '1.0.0',
  });

  server.tool(
    'list_known_issues',
    'List active vigilant sessions for the watched repository',
    ListKnownIssuesInput.shape,
    (args) => handleListKnownIssues(db, ListKnownIssuesInput.parse(args)),
  );

  server.tool(
    'analyze_snippet',
    'Classify a code snippet against vigilant domain patterns and identify issues',
    AnalyzeSnippetInput.shape,
    (args) => handleAnalyzeSnippet(neurolink, AnalyzeSnippetInput.parse(args)),
  );

  server.tool(
    'get_domain_pattern',
    'Get the full pattern description and fix example for a vigilant issue type',
    GetDomainPatternInput.shape,
    (args) => handleGetDomainPattern(GetDomainPatternInput.parse(args)),
  );

  server.tool(
    'get_session_status',
    'Get detailed status of a specific vigilant session by session ID',
    GetSessionStatusInput.shape,
    (args) => handleGetSessionStatus(db, GetSessionStatusInput.parse(args)),
  );

  server.tool(
    'approve_plan',
    'Approve a vigilant session plan (Gate 1). Optionally include modification instructions.',
    ApprovePlanInput.shape,
    (args) => handleApprovePlan(db, ApprovePlanInput.parse(args)),
  );

  return server;
}

/** Start HTTP SSE transport (for Cursor). */
export async function startHTTPServer(
  server: McpServer,
  port:   number,
): Promise<void> {
  const app = express();
  app.use(express.json());

  const transport = new StreamableHTTPServerTransport({ path: '/mcp' });
  await server.connect(transport);

  app.all('/mcp', (req, res) => transport.handleRequest(req, res));

  app.get('/health', (_req, res) => res.json({ status: 'ok', name: 'vigilant' }));

  app.listen(port, '127.0.0.1', () => {
    console.log(`vigilant MCP server running at http://127.0.0.1:${port}/mcp`);
  });
}

/** Start stdio transport (for Claude Desktop). */
export async function startStdioServer(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

---

## Transport Choice

| Mode | Flag | Used by |
|---|---|---|
| HTTP SSE | default / `--port` | Cursor, any HTTP MCP client |
| stdio | `--stdio` | Claude Desktop, local subprocess clients |

The server binds to `127.0.0.1` only — never `0.0.0.0`. Remote access requires explicit user config (documented in `docs/deployment.md`).

---

## npm Dependencies Added

```json
{
  "@modelcontextprotocol/sdk": "^1.0.0",
  "express": "^4.18.0"
}
```
