# Phase 7 — Client Integration

**File:** Configuration snippets and installation guide for Cursor, Claude Desktop, and Claude Code.

## Objective

Provide exact copy-paste config for every major MCP client. These snippets go in `docs/deployment.md` and the `README.md` quick-start section.

---

## Cursor

**Config file:** `~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "vigilant": {
      "url": "http://localhost:3001/mcp",
      "name": "vigilant",
      "description": "Autonomous code guardian — detects and fixes payment, security, reliability, and compliance issues"
    }
  }
}
```

**Steps:**
1. `vigilant serve` (in a separate terminal or as a background process)
2. Add the above to `~/.cursor/mcp.json`
3. Restart Cursor
4. In Cursor chat: `@vigilant list known issues`

---

## Claude Desktop

**Config file:** `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)  
`%APPDATA%\Claude\claude_desktop_config.json` (Windows)

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

**Note:** Claude Desktop launches vigilant as a subprocess using stdio. No separate `vigilant serve` needed.

---

## Claude Code

Claude Code supports HTTP MCP servers:

```bash
claude mcp add vigilant http://localhost:3001/mcp
```

---

## VS Code (with GitHub Copilot + MCP)

```json
// .vscode/mcp.json
{
  "servers": {
    "vigilant": {
      "type": "http",
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

---

## Verifying the Server

```bash
# Health check:
curl http://localhost:3001/health
# → {"status":"ok","name":"vigilant"}

# List tools (MCP protocol):
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

---

## Security Notes

- Server binds to `127.0.0.1` only — not accessible from the network by default
- To expose on LAN: `vigilant serve --host 0.0.0.0 --port 3001` (not recommended)
- The `approve_plan` tool advances a session without human confirmation at the terminal — treat MCP access as equivalent to terminal access to vigilant

These notes are repeated in `docs/security.md`.
