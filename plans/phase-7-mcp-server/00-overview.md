# Phase 7 — MCP Server

## Goal

Expose vigilant's intelligence as an MCP (Model Context Protocol) HTTP server that Cursor, Claude Code, and any MCP-compatible client can use. Once running, any AI editor can ask vigilant questions about the watched repository, get domain pattern information, and even approve plans — all from inside the editor's AI chat.

## In Scope

- MCP HTTP server using `@modelcontextprotocol/sdk`, localhost by default
- Five tools exposed:
  - `list_known_issues` — list all active/recent vigilant sessions
  - `analyze_snippet` — classify a code snippet against domain patterns
  - `get_domain_pattern` — return full pattern info for an issue type
  - `get_session_status` — detailed session info by session ID
  - `approve_plan` — programmatic Gate 1 approval (identical to `vigilant approve`)
- `vigilant serve [--port <port>]` CLI command
- Cursor and Claude Desktop config installation snippets

## Out of Scope

- WebSocket transport (HTTP SSE only)
- Authentication/API keys (localhost-only by default; security doc covers network exposure)
- Gate 2 merge via MCP (humans must be physically present for merge decisions)
- Multi-repo MCP (one server = one `vigilant.config.json` scope)

## File Structure Created

```
src/
└── mcp/
    ├── index.ts          ← createMCPServer(), startMCPServer()
    ├── types.ts          ← tool input/output schemas
    ├── tools/
    │   ├── listKnownIssues.ts
    │   ├── analyzeSnippet.ts
    │   ├── getDomainPattern.ts
    │   ├── getSessionStatus.ts
    │   └── approvePlan.ts
src/
└── commands/
    └── serve.ts          ← vigilant serve command
```

## Tool Summary

| Tool | Input | Output |
|---|---|---|
| `list_known_issues` | `{ domain?, status?, limit? }` | Array of session summaries |
| `analyze_snippet` | `{ code, language, domain? }` | `{ issueType, severity, confidence, explanation }` |
| `get_domain_pattern` | `{ issueType }` | Full `FixStrategy` for that issue type |
| `get_session_status` | `{ sessionId }` | Full `IssueSession` detail |
| `approve_plan` | `{ sessionId, modifications? }` | `{ success, message }` |

## MCP Client Config

**Cursor** (`~/.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "vigilant": {
      "url": "http://localhost:3001/mcp",
      "name": "vigilant"
    }
  }
}
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "vigilant": {
      "command": "vigilant",
      "args": ["serve", "--stdio"]
    }
  }
}
```

## Success Criteria

- `vigilant serve` starts an MCP server on port 3001 (configurable)
- All five tools respond correctly to MCP client requests
- Cursor can list vigilant sessions inside its AI chat
- Claude Desktop can analyze a pasted code snippet and identify the issue type
- `approve_plan` via MCP advances a session exactly like `vigilant approve`
- Server handles concurrent tool calls without crashing
