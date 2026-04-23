# Phase 1 — Implementation Checklist

## Project Setup (`10-project-setup.md`)
- [ ] Create `package.json` — all dependencies, `bin.vigilant → dist/bin.js`, `prepublishOnly: tsc`, `engines.node: >=20`, `files: ["dist","knowledge"]`
- [ ] Create `tsconfig.json` — `strict: true`, `paths: {"@/*":["./src/*"]}`, `outDir: dist`, `target: ES2022`, `module: Node16`, `moduleResolution: Node16`
- [ ] Create `src/bin.ts` — shebang, imports root Commander program, calls `program.parseAsync(process.argv)`, top-level error handler → `process.exit(1)`
- [ ] Create `.gitignore` — `dist/`, `node_modules/`
- [ ] Create `~/.vigilant/` directory structure on first `vigilant init` run

## Types (`01-types.md`)
- [ ] Create `src/config/types.ts` — full `VigilantConfig` type with all fields and JSDoc
- [ ] Create `src/lib/types.ts` — `LogLevel`, `LogEntry`, CLI option types

## Errors (`08-errors.md`)
- [ ] Create `src/lib/errors.ts` — `VigilantError` base class
- [ ] Add `ConfigError extends VigilantError`
- [ ] Add `GitHubAPIError extends VigilantError` with `statusCode` and `endpoint` fields
- [ ] Add `GitHubRateLimitError extends GitHubAPIError` with `retryAfterSeconds` field
- [ ] Add `AIProviderError extends VigilantError` with optional `statusCode` and `provider` fields
- [ ] Add `DatabaseError extends VigilantError` with `operation` field
- [ ] Add `ExecutorError extends VigilantError` with `step` and `sessionId` fields

## Constants (`09-constants.md`)
- [ ] Create `src/lib/constants.ts` — all path constants (`VIGILANT_DIR`, `CONFIG_PATH`, `STATE_DB_PATH`, `KNOWLEDGE_DB_PATH`)
- [ ] Add `SESSION_ID_PREFIX`, `BRANCH_PREFIX`, `PR_TITLE_SUFFIX`
- [ ] Add `STAGE` const object with all 11 stage values, `TERMINAL_STAGES` array
- [ ] Add watcher constants: `MIN_WATCH_INTERVAL_SECONDS`, `DEFAULT_WATCH_INTERVAL_SECONDS`, `PR_SCAN_PER_PAGE`, `COMMIT_SCAN_PER_PAGE`, `PATTERN_SCAN_MIN_INTERVAL_SECONDS`
- [ ] Add agent constants: `DEFAULT_MAX_ITERATIONS`, `GOAL_PROGRESS_THRESHOLD`, `STALL_MIN_DELTA`, `STALL_THRESHOLD`, `AI_MAX_RETRIES`, `AI_RETRY_BASE_MS`
- [ ] Add executor constants: `CI_POLL_INTERVAL_SECONDS`, `CI_TIMEOUT_SECONDS`
- [ ] Add `MCP_DEFAULT_PORT`, `LEARNER_IDLE_TICKS_TRIGGER`

## Database (`02-database.md`)
- [ ] Create `src/db/migrations/state.sql` — `agent_sessions` (with `self_review_count` column), `watcher_state` tables with all columns and indexes
- [ ] Create `src/db/migrations/knowledge.sql` — `knowledge_documents` table (with `source_type` column), `scope`+`domain` index; `learning_topics` table
- [ ] Create `src/db/index.ts` — `getStateDb()` and `getKnowledgeDb()` singletons, WAL mode enabled, runs migrations on first open
- [ ] Create `src/db/queries/sessions.ts` — `createSession`, `getSession`, `saveSession` (includes `self_review_count`), `listSessions`, `listSessionsByStage`, `activeSessionExists`, `getNextRunNumber`
- [ ] Create `src/db/queries/watcher.ts` — `getWatcherState`, `upsertWatcherState`
- [ ] Create `src/db/queries/knowledge.ts` — `addKnowledgeDocument` (idempotent, includes `source_type`), `searchDocuments` (always requires `scope` param), `documentExistsByUrl`

## Config (`03-config.md`)
- [ ] Create `src/config/index.ts` — `loadConfig()` reads and validates `~/.vigilant/config.json`, throws `ConfigError` if missing or invalid
- [ ] Implement `validateConfig(raw)` — checks required fields, enforces `watchIntervalSeconds >= 30`, coerces defaults
- [ ] Implement `saveConfig(config)` — writes JSON + `fs.chmod(path, 0o600)`
- [ ] Implement `setConfigValue(key, value)` — loads, patches single key, saves
- [ ] Create `src/config/init.ts` — 8-step `inquirer` wizard: GitHub token, Gemini key, Groq key (optional), default repos, interval, domains; validates token on entry; writes config on completion

## Logger (`05-logger.md`)
- [ ] Create `src/lib/logger.ts` — `createLogger(context)` factory returning `{ debug, info, warn, error }` methods
- [ ] Every log line format: `[ISO_TIMESTAMP] [LEVEL] [context] message {data?}`
- [ ] Apply 5 secret-stripping regex patterns before writing any line
- [ ] Use `chalk` for level-coloured output

## GitHub Client (`06-github-client.md`)
- [ ] Create `src/lib/github.ts` — `getGitHub(token)` singleton Octokit
- [ ] Implement `githubRequest(endpoint, params)` — wraps Octokit, catches 403/429 → throws `GitHubRateLimitError`, catches other non-2xx → throws `GitHubAPIError`
- [ ] Implement `conditionalGet(endpoint, params, lastEtag)` — adds `If-None-Match` header, returns `{ data, etag, notModified }`

## CLI (`04-cli.md`)
- [ ] Create `src/cli/index.ts` — Commander.js root program, version from `package.json`, global `--debug` flag
- [ ] Register all 8 commands: `init`, `start`, `status`, `session <id>`, `approve <id>`, `learn`, `serve`, `config`
- [ ] Stub unimplemented commands with `"Coming in phase N"` so `vigilant --help` works immediately
- [ ] `vigilant init` fully implemented here (calls `runInitWizard`)
- [ ] `vigilant config show` and `vigilant config set <key> <value>` fully implemented here

## Verification
- [ ] `npm run build` — zero TypeScript errors
- [ ] `npm run typecheck` — zero errors
- [ ] `vigilant --help` — all 8 commands listed
- [ ] `vigilant init` — wizard runs end-to-end, config saved, both DBs created
- [ ] `vigilant config show` — all keys displayed, secrets masked
- [ ] `~/.vigilant/config.json` file permissions are `0o600`
- [ ] Logger prints coloured output with correct format on every command
- [ ] `getStateDb()` called twice returns the same SQLite instance (singleton)
