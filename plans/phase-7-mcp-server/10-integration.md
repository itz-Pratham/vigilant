# Phase 7 — Integration

**File:** Wiring Phase 7 into the CLI and showing the complete MCP call flow.

## Objective

Show exactly how the MCP server sits alongside the daemon, what the client call flow looks like end-to-end, and what new files and dependencies Phase 7 adds.

---

## System Integration Diagram

```
┌──────────────────────────────────────────────────────────────┐
│  vigilant daemon (vigilant start)                            │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Watcher → Agent → HITL → Executor → SQLite state.db    │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                              │ reads/writes state.db
                              ▼
                     ~/.vigilant/state.db   (SQLite WAL mode)
                              │ reads state.db
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  vigilant MCP server (vigilant serve)                        │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  McpServer (HTTP SSE or stdio)                        │   │
│  │  ├─ list_known_issues   → loadSession / SELECT        │   │
│  │  ├─ analyze_snippet     → NeuroLink.generate()        │   │
│  │  ├─ get_domain_pattern  → loadActiveDomainPacks()     │   │
│  │  ├─ get_session_status  → loadSession()               │   │
│  │  └─ approve_plan        → runApproveCommand()         │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
                              ▲
              MCP protocol (HTTP SSE or stdio)
                              │
        ┌──────────────┬──────┴──────┬──────────────┐
        │              │             │              │
     Cursor       Claude Desktop  Claude Code    VS Code
```

---

## MCP Call Flow (Cursor)

```
User in Cursor chat: "@vigilant What issues are in this repo?"
  │
  ▼
Cursor → POST http://localhost:3001/mcp
  body: { method: "tools/call", params: { name: "list_known_issues", arguments: { limit: 10 } } }
  │
  ▼
McpServer → handleListKnownIssues(db, { limit: 10 })
  → SELECT * FROM agent_sessions WHERE stage NOT IN ('merged', 'closed') LIMIT 10
  │
  ▼
McpServer → { content: [{ type: 'text', text: "Found 3 active session(s):\n..." }] }
  │
  ▼
Cursor renders text in chat
```

---

## New Files Added This Phase

```
src/
└── mcp/
    ├── index.ts                  ← createMCPServer(), startHTTPServer(), startStdioServer()
    ├── types.ts                  ← Zod schemas + output types for all 5 tools
    └── tools/
        ├── listKnownIssues.ts    ← handleListKnownIssues()
        ├── analyzeSnippet.ts     ← handleAnalyzeSnippet()
        ├── getDomainPattern.ts   ← handleGetDomainPattern()
        ├── getSessionStatus.ts   ← handleGetSessionStatus()
        └── approvePlan.ts        ← handleApprovePlan()
src/
└── commands/
    └── serve.ts                  ← vigilant serve command
```

---

## New npm Dependencies

```json
{
  "@modelcontextprotocol/sdk": "^1.0.0",
  "express": "^4.18.0",
  "zod": "^3.22.0"
}
```

---

## bin.ts Registration

```typescript
import { serveCommand } from './commands/serve.js';
program.addCommand(serveCommand);
```
