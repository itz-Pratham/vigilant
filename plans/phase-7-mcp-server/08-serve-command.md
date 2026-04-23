# Phase 7 — serve Command

**File:** `src/commands/serve.ts`

## Objective

`vigilant serve` starts the MCP server. Supports `--port` for HTTP SSE transport and `--stdio` for Claude Desktop. Requires a valid config file (same as `vigilant start`).

---

## Implementation

```typescript
// src/commands/serve.ts
import { Command }        from 'commander';
import { loadConfig }     from '../config.js';
import { getStateDb }     from '../db/state.js';
import { getKnowledgeDb } from '../db/knowledge.js';
import { Octokit }        from '@octokit/rest';
import { NeuroLink }      from '@juspay/neurolink';
import { createMCPServer, startHTTPServer, startStdioServer } from '../mcp/index.js';
import chalk              from 'chalk';

const DEFAULT_PORT = 3001;

export const serveCommand = new Command('serve')
  .description('Start the vigilant MCP server for Cursor/Claude Desktop integration')
  .option('--port <port>', 'HTTP port to listen on', String(DEFAULT_PORT))
  .option('--stdio', 'Use stdio transport instead of HTTP (for Claude Desktop)')
  .action(async (opts) => {
    const config = await loadConfig().catch(() => {
      console.error(chalk.red('No vigilant.config.json found. Run: vigilant init'));
      process.exit(1);
    });

    const db  = getStateDb();
    const kdb = getKnowledgeDb(config.vigilantDir);

    const neurolink = new NeuroLink({
      providers: [
        { name: 'google', apiKey: config.geminiApiKey },
        { name: 'groq',   apiKey: config.groqApiKey },
      ],
      rag: { db: kdb },
    });

    const server = createMCPServer(db, neurolink);

    if (opts.stdio) {
      await startStdioServer(server);
      // stdio server: no console output (stdout is the transport)
    } else {
      const port = parseInt(opts.port, 10);
      await startHTTPServer(server, port);
      console.log(chalk.green('✓ vigilant MCP server ready'));
      console.log(chalk.grey('  Add to Cursor (~/.cursor/mcp.json):'));
      console.log(chalk.grey(`    { "mcpServers": { "vigilant": { "url": "http://localhost:${port}/mcp" } } }`));
    }
  });
```

---

## Registration in bin.ts

```typescript
// src/bin.ts (addition):
import { serveCommand } from './commands/serve.js';
program.addCommand(serveCommand);
```

---

## Process Lifecycle

- HTTP mode: server keeps the process alive (Express `listen` holds the event loop)
- stdio mode: server keeps alive via open stdin

Signal handling (both modes):
```typescript
process.on('SIGINT',  () => { server.close(); process.exit(0); });
process.on('SIGTERM', () => { server.close(); process.exit(0); });
```

---

## Concurrent with Daemon

The MCP server and the watcher daemon can run simultaneously in separate terminal tabs:

```bash
# Tab 1:
vigilant start

# Tab 2:
vigilant serve
```

Both read from the same SQLite state database at `~/.vigilant/state.db`. SQLite's WAL mode (enabled in `getStateDb()`) makes concurrent reads and writes safe.
