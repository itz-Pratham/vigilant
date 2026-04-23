# Phase 1 — Foundation

## Goal

A fully runnable TypeScript project. Working CLI scaffold, config wizard, SQLite schema initialised, and structured logger. No AI calls, no GitHub API calls yet. This phase creates the skeleton every other phase builds on.

## In Scope

- `package.json`, `tsconfig.json`, `.gitignore`, `eslint.config.js`
- All npm dependencies declared (even those used in later phases)
- `vigilant init` wizard: collects GitHub token, AI keys, domain packs, saves to `~/.vigilant/config.json` with mode `0o600`
- `vigilant config show` and `vigilant config set <key>=<value>` commands
- SQLite initialisation: creates `~/.vigilant/state.db` and `~/.vigilant/knowledge.db` with correct schemas
- Structured logger: every line has ISO timestamp, log level, and optional session ID
- `src/lib/constants.ts`: all string literals centralised
- `src/lib/errors.ts`: typed error classes (`VigilantError`, `GitHubAPIError`, `AIProviderError`, `ConfigError`)
- Commander.js entry at `src/cli/index.ts` with all commands stubbed (help text works, implementations come in later phases)

## Out of Scope

- Actual GitHub API calls (Phase 2)
- Actual AI calls (Phase 3)
- HITL prompts (Phase 4)

## File Structure Created

```
src/
├── cli/
│   └── index.ts          ← Commander.js root, all commands registered
├── config/
│   ├── index.ts          ← load, validate, save config
│   ├── init.ts           ← interactive init wizard (inquirer)
│   └── types.ts          ← VigilantConfig type
├── db/
│   ├── index.ts          ← open SQLite connections, run migrations
│   ├── schema.sql        ← full schema for state.db and knowledge.db
│   └── queries/
│       ├── sessions.ts   ← all agent_sessions queries
│       ├── watcher.ts    ← all watcher_state queries
│       └── knowledge.ts  ← all knowledge_documents queries
└── lib/
    ├── constants.ts      ← all string constants
    ├── errors.ts         ← typed error classes
    └── logger.ts         ← structured logger
```

## Key Implementation Details

### Config schema

```typescript
type VigilantConfig = {
  githubToken: string;
  geminiApiKey?: string;
  groqApiKey?: string;
  openaiApiKey?: string;
  defaultRepos: string[];         // ["owner/repo", ...]
  watchIntervalSeconds: number;   // default: 60
  domains: string[];              // ["payments"], ["security"], etc.
  maxIterations: number;          // default: 20
};
```

### Logger format

Every log line: `[2026-04-21T01:30:00Z] [INFO] [SESS_vigilant_...] message here`
When no session: `[2026-04-21T01:30:00Z] [INFO] [daemon] message here`

### Init wizard flow

1. Welcome message
2. Ask for GitHub token (validate: must start with `ghp_` or `github_pat_`)
3. Ask for AI provider choice (Gemini recommended, Groq, OpenAI, Ollama)
4. Ask for API key for chosen provider (validate: non-empty)
5. Ask for optional fallback provider + key
6. Ask which domain packs to enable (multi-select: payments, security, reliability)
7. Ask for default repos to watch (optional, comma-separated)
8. Save config + initialise DBs + print success summary

## Success Criteria

- `vigilant --help` lists all commands with correct descriptions
- `vigilant init` runs the wizard, saves config, creates DBs, prints confirmation
- `vigilant config show` prints config with keys masked (show only first 4 chars)
- SQLite DB files exist at `~/.vigilant/state.db` and `~/.vigilant/knowledge.db`
- Logger output appears on every command with correct format
- `npm run build` compiles with zero TypeScript errors
