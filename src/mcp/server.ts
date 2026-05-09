// src/mcp/server.ts
// Entry point for `vigilant serve` — delegates to src/mcp/index.ts.

import chalk        from 'chalk';
import { NeuroLink } from '@juspay/neurolink';
import { createMCPServer, startHTTPServer, startStdioServer } from './index.js';

const DEFAULT_PORT = 3741;

/**
 * Starts the vigilant MCP server.
 * HTTP mode (default): binds to 127.0.0.1:{port}/mcp
 * Stdio mode (--stdio): communicates via stdin/stdout for Claude Desktop
 */
export async function startMcpServer(opts: { port?: string; host?: string; stdio?: boolean }): Promise<void> {
  const neurolink = new NeuroLink();
  const server    = createMCPServer(neurolink);

  if (opts.stdio) {
    // stdout is now the transport — silence all console output
    await startStdioServer(server);
    return;
  }

  const port = opts.port ? parseInt(opts.port, 10) : DEFAULT_PORT;
  await startHTTPServer(server, port);

  console.log(chalk.green(`\n  ✓ vigilant MCP server running on http://127.0.0.1:${port}/mcp\n`));
  console.log(chalk.dim('  Add to Cursor (~/.cursor/mcp.json):'));
  console.log(chalk.dim(`    { "mcpServers": { "vigilant": { "url": "http://localhost:${port}/mcp" } } }\n`));
  console.log(chalk.dim('  Add to Claude Desktop config:'));
  console.log(chalk.dim('    { "mcpServers": { "vigilant": { "command": "vigilant", "args": ["serve","--stdio"] } } }\n'));
  console.log(chalk.dim('  Health check: curl http://127.0.0.1:' + port + '/health\n'));
}
