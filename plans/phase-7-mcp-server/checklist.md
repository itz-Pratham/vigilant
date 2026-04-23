# Phase 7 — Implementation Checklist

## Types (`01-types.md`)
- [ ] Create `src/mcp/types.ts`
- [ ] `ListKnownIssuesInput` Zod schema: `{ domain?, status?, limit }` — status enum covers all 13 valid stages: `discovered`, `investigating`, `planning`, `awaiting_self_review`, `self_reviewing`, `awaiting_approval`, `executing`, `pr_created`, `awaiting_merge`, `merged`, `skipped`, `closed`, `blocked`
- [ ] `AnalyzeSnippetInput` Zod schema: `{ code, language, domain? }`
- [ ] `GetDomainPatternInput` Zod schema: `{ issueType }`
- [ ] `GetSessionStatusInput` Zod schema: `{ sessionId }`
- [ ] `ApprovePlanInput` Zod schema: `{ sessionId, modifications? }`
- [ ] `SessionSummary` output type
- [ ] `AnalyzeSnippetOutput` output type with confidence field (0.0–1.0)
- [ ] `DomainPatternOutput` output type with bad/good examples and search query
- [ ] `ApprovePlanOutput` output type: `{ success, message }`

## Server Setup (`02-server-setup.md`)
- [ ] Create `src/mcp/index.ts`
- [ ] `createMCPServer(db, neurolink)` — registers all 5 tools with Zod schemas
- [ ] `startHTTPServer(server, port)` — Express + `StreamableHTTPServerTransport`, binds to `127.0.0.1`
- [ ] `startStdioServer(server)` — `StdioServerTransport`
- [ ] `GET /health` endpoint → `{ status: 'ok', name: 'vigilant' }`
- [ ] Add `@modelcontextprotocol/sdk`, `express` to package.json
- [ ] `SIGINT`/`SIGTERM` handlers: `server.close(); process.exit(0)`

## list_known_issues (`03-list-known-issues.md`)
- [ ] Create `src/mcp/tools/listKnownIssues.ts`
- [ ] `handleListKnownIssues(db, input)` — SELECT from `agent_sessions` with optional domain/stage filters
- [ ] Excludes `merged` and `closed` stages by default (not `done`)
- [ ] `formatSessionList()` — bullet format with severity, issueType, stage, repo, age, PR URL
- [ ] `formatAge()` — mins/hours/days ago
- [ ] Returns `No active vigilant sessions found.` when empty

## analyze_snippet (`04-analyze-snippet.md`)
- [ ] Create `src/mcp/tools/analyzeSnippet.ts`
- [ ] `handleAnalyzeSnippet(neurolink, input)`
- [ ] Loads active domain packs; filters to requested domain if specified
- [ ] Builds domain context block: issueType + description for all fix strategies
- [ ] NeuroLink `generate()` with JSON output mode
- [ ] Parse JSON response: `{ issueType, severity, confidence, explanation, suggestion }`
- [ ] `formatAnalysis()` — `✅ No issues` if confidence < 0.3, else `⚠️ Issue detected:` format
- [ ] Graceful fallback if JSON parse fails

## get_domain_pattern (`05-get-domain-pattern.md`)
- [ ] Create `src/mcp/tools/getDomainPattern.ts`
- [ ] `handleGetDomainPattern(input)` — loads packs, finds strategy for issueType
- [ ] `findPackForIssueType()` from Phase 3 `domain-context.ts` (reuse)
- [ ] If unknown issueType: list all available issue types in response
- [ ] Format: heading, domain/severity, description, bad example, good example, search query

## get_session_status (`06-get-session-status.md`)
- [ ] Create `src/mcp/tools/getSessionStatus.ts`
- [ ] `handleGetSessionStatus(db, input)` — `loadSession()` from Phase 3
- [ ] Markdown table with all session fields
- [ ] Plan section: summary, root cause, changes list, test suggestions
- [ ] Action hint if stage = `awaiting_approval`
- [ ] Returns `Session not found` message if session ID unknown

## approve_plan (`07-approve-plan.md`)
- [ ] Create `src/mcp/tools/approvePlan.ts`
- [ ] `handleApprovePlan(db, input)` — validates stage = `awaiting_approval` before approving
- [ ] Calls `runApproveCommand(db, sessionId, modifications?)`
- [ ] Returns branch name and file count on success
- [ ] Gate 2 merge is NOT exposed via MCP (intentional safety constraint)
- [ ] Returns typed error messages for: session not found, wrong stage, no plan yet

## serve Command (`08-serve-command.md`)
- [ ] Create `src/commands/serve.ts`
- [ ] `vigilant serve` — default HTTP on port 3001
- [ ] `vigilant serve --port <port>` — custom port
- [ ] `vigilant serve --stdio` — stdio transport for Claude Desktop
- [ ] Config check on startup — exit with message if no `vigilant.config.json`
- [ ] Print Cursor config snippet after HTTP start
- [ ] Register in `src/bin.ts`

## Client Integration (`09-client-integration.md`)
- [ ] Cursor config snippet in `docs/deployment.md`: `~/.cursor/mcp.json`
- [ ] Claude Desktop config snippet: macOS + Windows paths
- [ ] Claude Code CLI command: `claude mcp add vigilant`
- [ ] VS Code config snippet: `.vscode/mcp.json`
- [ ] Health check `curl` command in docs
- [ ] `tools/list` verification `curl` command
- [ ] Security note in `docs/security.md`: localhost-only by default

## Integration (`10-integration.md`)
- [ ] System integration diagram: daemon + MCP server sharing state.db
- [ ] WAL mode confirmed in `getStateDb()` so daemon and MCP server can coexist
- [ ] MCP call flow diagram: user → Cursor → HTTP → McpServer → SQLite → response
- [ ] New files listed: `src/mcp/**`, `src/commands/serve.ts`

## Verification
- [ ] `vigilant serve` starts without errors (config must exist)
- [ ] `curl http://localhost:3001/health` returns `{ status: 'ok', name: 'vigilant' }`
- [ ] `list_known_issues` returns sessions visible in `vigilant status`
- [ ] `analyze_snippet` with a hardcoded `catch(e) {}` returns `SILENT_ERROR_SWALLOW`
- [ ] `get_domain_pattern MISSING_IDEMPOTENCY` returns bad/good examples
- [ ] `get_session_status <id>` returns same info as `vigilant session <id>`
- [ ] `approve_plan <id>` on an `awaiting_approval` session advances it to `executing`
- [ ] `approve_plan <id>` on a `merged` session returns a typed error (not a crash)
- [ ] `vigilant serve --stdio` starts without printing to stdout (stdio is the transport)
- [ ] Daemon and MCP server can run simultaneously on the same machine