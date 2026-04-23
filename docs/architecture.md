# vigilant — System Architecture

---

## Overview

vigilant is a local-first autonomous daemon and cross-verification intelligence layer. Every component runs on the user's machine. The only external systems it talks to are the GitHub API and the user's chosen AI provider. There is no vigilant backend.

```
User's machine
│
├── vigilant daemon (Node.js process)
│   ├── Watcher          → polls GitHub API every 60s
│   ├── Tool Observer    → reads Snyk/CodeRabbit/Dependabot PR comments (optional)
│   ├── Agent            → NeuroLink agentic loop per issue
│   ├── Self-Reviewer    → reviews vigilant's own PRs before Gate 1 (max 3 iterations)
│   ├── Executor         → GitHub API writes (branch, files, PR)
│   ├── Learner          → NeuroLink AutoResearch when idle
│   └── MCP Server       → HTTP server for Cursor / Claude Code
│
├── ~/.vigilant/
│   ├── config.json      → credentials and settings (mode 0o600)
│   ├── state.db         → SQLite: sessions, watcher state
│   └── knowledge.db     → SQLite: RAG documents (6 knowledge sources)
│
└── External calls
    ├── api.github.com   → GitHub REST API (token auth)
    └── AI provider      → Gemini / Groq / OpenAI (key auth)
```

---

## Cross-Verification Loops

Three loops form vigilant's core value. All three are independent and run concurrently.

### Loop A — Human PR Review (with external tools)

```
Human opens PR
  ├── Snyk reviews → posts comment on PR
  ├── CodeRabbit reviews → posts comment on PR
  └── Tool Observer reads all tool comments via GitHub API
        ↓
  Agent investigates with team context (git history, decision docs, RAG)
        ↓
  vigilant posts ONE unified comment:
    - synthesised findings from all tools
    - team context ("this was fixed in Jan, see commit a3f2")
    - severity with confidence score
```

### Loop B — vigilant's Own Fix PR (self-verification)

```
Agent generates Plan → awaiting_self_review
  ↓
Self-Review Loop (max 3 iterations):
  → reads own planned diff
  → checks: regressions? missing imports? team pattern violated?
  → if issues: pushes corrections, re-reviews
  → if clean: advances to awaiting_approval
  ↓
Gate 1 — Human sees PR that has already been cross-verified
  ↓
Executor opens PR
  ├── Snyk scans vigilant's code → posts comment (if present)
  ├── CodeRabbit reviews vigilant's code → posts comment (if present)
  └── Tool Observer reads feedback → vigilant can push further improvements
  ↓
Gate 2 — Human merges
```

### Loop C — Idle Learning

```
Watcher finds no new issues on a tick
  ↓
Learner picks next topic from round-robin queue
  ├── GitHub PR researcher (other repos doing things right)
  ├── GitHub Security Advisories reader
  ├── Web researcher (NeuroLink AutoResearch)
  └── Git history reader (YOUR repo's past patterns)
  ↓
knowledge.db grows → next investigation is smarter
```

---

## Fallback Mode (No External Tools)

When Snyk, CodeRabbit, and Dependabot are absent (private repo, no paid subscription):

```
vigilant IS the reviewer (Loop A skipped — no external tool comments to read)
  ↓
Agent investigates with knowledge base alone
  ↓
Self-Review Loop (Loop B) runs with max 3 iterations
  → NeuroLink: "does this fix introduce any new issues?"
  → checks domain knowledge, git history, team decisions
  → pushes corrections if needed
  ↓
Gate 1 — Human sees a PR that vigilant has already critiqued itself
```

Fallback mode is first-class. Private repo teams without paid tooling get the same quality output.

---

## Knowledge Stack (Six Sources, One Store)

All six sources flow into `knowledge.db` via the same `addDocument()` interface:

| Source | How it enters | When it's used |
|---|---|---|
| Current codebase | Pattern scanner reads actual code | Every watcher tick |
| Git history (YOUR repo) | Learner reads merged PRs + commit messages | Investigation + drift detection |
| Team decision docs | Learner reads `decision.md`, `adr/`, `docs/` | Intent verification |
| User feedback | Approved/modified plans go back as labeled examples | Next similar issue |
| Other GitHub repos | Idle learner searches community patterns | Enriches RAG |
| Web research | NeuroLink AutoResearch (blogs, CVEs, advisories) | Idle learning |

---

## Agentic Loop State Machine

Each detected issue becomes a session. Sessions move through stages in one direction only (except `blocked`, which can recover).

```
discovered
    │  Watcher creates session, saves to SQLite
    ▼
investigating
    │  Agent: step 0 (getCurrentTime) → step 1 (sequentialThinking)
    │  → steps 2..N (toolChoice: auto) until goalProgress ≥ 0.9
    │  Tools: readFile, searchCode, ragSearch, readPRDiff, searchWeb,
    │         readGitHistory, readTeamDecisions
    ▼
planning
    │  Agent generates structured Plan JSON
    ▼
awaiting_self_review
    │  Self-Reviewer reads planned diff, checks for regressions
    ▼
self_reviewing  (max 3 iterations)
    │  If issues found: push corrections → back to awaiting_self_review
    │  If clean:
    ▼
awaiting_approval          ◀── GATE 1 (human: approve / modify / skip)
    │
    ├── skip ──────────────────────────────────────▶ skipped (terminal)
    │
    ▼ approve
executing
    │  BranchCreator → CodeWriter (per file) → PRCreator
    │  Tool Observer reads Snyk/CodeRabbit feedback on vigilant's PR
    ▼
pr_created
    │  CIMonitor polls every 60s
    ▼
awaiting_merge             ◀── GATE 2 (human: merge / review / close)
    │
    ├── close ─────────────────────────────────────▶ closed (terminal)
    │
    ▼ merge
merged (terminal)
→ Knowledge updated with confirmed fix pattern

Any stage can transition to:
blocked ──▶ previous stage (on human recovery or auto-retry)
```

---

## Session State Schema (SQLite)

```sql
CREATE TABLE agent_sessions (
  session_id         TEXT PRIMARY KEY,
  repo_owner         TEXT NOT NULL,
  repo_name          TEXT NOT NULL,
  domain             TEXT NOT NULL,
  issue_type         TEXT NOT NULL,
  stage              TEXT NOT NULL DEFAULT 'discovered',
  severity           TEXT NOT NULL,
  confidence         REAL NOT NULL DEFAULT 0.0,
  source_ref         TEXT NOT NULL,
  iteration_count    INTEGER NOT NULL DEFAULT 0,
  goal_progress      REAL NOT NULL DEFAULT 0.0,
  key_findings       TEXT,          -- JSON array of strings
  data_collected     TEXT,          -- JSON object
  plan               TEXT,          -- JSON Plan object, null until planning stage
  branch_name        TEXT,
  pr_number          INTEGER,
  pr_url             TEXT,
  pr_head_sha        TEXT,
  ci_status          TEXT,
  executor_step      TEXT,          -- 'branch_created' | 'files_written' | 'pr_created'
  self_review_count  INTEGER NOT NULL DEFAULT 0,
  blocker_reason     TEXT,
  stall_count        INTEGER NOT NULL DEFAULT 0,
  run_number         INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE watcher_state (
  repo_owner         TEXT NOT NULL,
  repo_name          TEXT NOT NULL,
  scanner_name       TEXT NOT NULL,
  last_etag          TEXT,
  last_checked_at    TEXT NOT NULL,
  PRIMARY KEY (repo_owner, repo_name, scanner_name)
);
```

---

## Knowledge Base Schema (SQLite)

```sql
CREATE TABLE knowledge_documents (
  id                 TEXT PRIMARY KEY,
  scope              TEXT NOT NULL,   -- 'global' or 'repo:owner/name'
  domain             TEXT NOT NULL,
  topic              TEXT NOT NULL,
  source_url         TEXT NOT NULL UNIQUE,
  source_type        TEXT NOT NULL,   -- 'git_history'|'team_decision'|'user_feedback'|'github_repo'|'web'|'codebase'
  title              TEXT NOT NULL,
  content            TEXT NOT NULL,
  key_points         TEXT NOT NULL DEFAULT '[]',  -- JSON string[]
  confidence         REAL NOT NULL DEFAULT 1.0,
  learned_at         TEXT NOT NULL,
  created_at         TEXT NOT NULL
);

CREATE INDEX idx_knowledge_scope_domain ON knowledge_documents (scope, domain);
CREATE UNIQUE INDEX idx_knowledge_url ON knowledge_documents (source_url);
```

RAG queries always filter by `scope IN ('global', 'repo:owner/name')` — enforced inside `src/rag/index.ts`.

---

## Tool Observer — Reading External Tool Findings

The Tool Observer reads PR review comments from external tools via the GitHub API. It looks for comments posted by known bot usernames:

| Tool | Bot username | Free for |
|---|---|---|
| Snyk | `snyk-bot` | Public repos only |
| CodeRabbit | `coderabbitai[bot]` | Public repos only |
| Dependabot | `dependabot[bot]` | All repos (GitHub built-in) |
| GitHub Security | `github-advanced-security[bot]` | Public repos, GitHub Advanced Security paid |

```typescript
// ExternalToolFinding — read from PR review comments
type ExternalToolFinding = {
  tool: 'snyk' | 'coderabbit' | 'dependabot' | 'github_security';
  comment: string;
  severity?: string;
  file?: string;
  line?: number;
  prNumber: number;
};
```

When none of these bots are present on a PR, vigilant proceeds in fallback mode.

---

## Watcher Tick Internals

Each 60-second tick runs five scanners in parallel. Each scanner uses ETag conditional requests — if GitHub returns 304 (not modified), the request costs zero rate limit tokens.

| Scanner | GitHub API endpoint | What triggers an issue |
|---|---|---|
| PR Scanner | `GET /repos/{owner}/{repo}/pulls` | New or updated PR touching domain-relevant file paths |
| Commit Scanner | `GET /repos/{owner}/{repo}/commits` | Push containing a known anti-pattern signature |
| CI Scanner | `GET /repos/{owner}/{repo}/actions/runs` | Failed run whose job name matches domain keywords |
| Dependency Scanner | `GET /repos/{owner}/{repo}/contents/package.json` + GitHub Releases | Payment/security/compliance SDK version behind latest |
| Pattern Scanner | `GET /search/code` | Codebase-wide grep for domain-specific anti-patterns |

The Tool Observer also runs each tick: reads comments on open PRs from known tool bots.

Detected issues are deduplicated against existing `agent_sessions` before spawning a new session.

---

## NeuroLink Integration

All AI calls use `@juspay/neurolink` with two providers configured:

```typescript
const neurolink = new NeuroLink({
  providers: [
    { name: 'google', apiKey: config.geminiApiKey },   // primary
    { name: 'groq',   apiKey: config.groqApiKey }      // automatic fallback
  ]
});
```

NeuroLink features used:
- `generate()` with `prepareStep` for the agentic loop (investigation + self-review)
- `rag.addDocument()` and `rag.search()` for the knowledge base (all 6 sources)
- AutoResearch for idle-mode learning (web + GitHub)
- MCP tool definitions for the MCP server mode
- Built-in provider failover (no code needed)

---

## MCP Server Tool Definitions

| Tool | Input | Output |
|---|---|---|
| `list_known_issues` | `repo: string` | Array of sessions with stage, severity, issueType |
| `analyze_snippet` | `code: string, domain: string` | Pattern analysis result with matched rules |
| `get_domain_pattern` | `patternName: string, domain: string` | RAG document content |
| `get_session_status` | `sessionId: string` | Full session object |
| `approve_plan` | `sessionId: string` | Confirmation that Gate 1 was triggered |

---

## Domain Pack Architecture

A `DomainPack` is a self-contained configuration object. Domain packs are reinforced over time by all six knowledge sources — they are living objects, not static rule sets.

```typescript
interface DomainPack {
  id: string;                    // 'payments' | 'security' | 'reliability' | 'compliance'
  name: string;                  // Human-readable label
  patternRules: PatternRule[];   // Search queries + confidence scoring
  filePathPatterns: string[];    // Glob patterns to scope PR scanner
  ciKeywords: string[];          // Job name substrings to match CI scanner
  knowledgeSeedDir: string;      // Path under knowledge/{domain}/
  fixStrategies: Record<IssueType, FixStrategy>;
}
```

The same watcher, agent, executor, and learner run for every domain. Domain affects only:
1. Which files the PR scanner considers relevant
2. Which GitHub Search queries the pattern scanner fires
3. Which CI job names the CI scanner watches
4. Which RAG documents the agent loads on investigation start
5. Which fix strategy template the code writer uses

**v1 ships with four packs:**

| Pack | Issue types | Target audience |
|---|---|---|
| `payments` | 7 | Juspay, Stripe, Razorpay, any checkout team |
| `security` | 5 | Any production backend |
| `reliability` | 5 | Uber, Swiggy, Zomato, any high-traffic service |
| `compliance` | 5 | Goldman Sachs, healthtech, any GDPR-regulated product |

Multiple domains can be active simultaneously via config: `"domains": ["payments", "compliance"]`.

---

## Rate Limit Strategy

| API | Limit | Strategy |
|---|---|---|
| GitHub REST (authenticated) | 5000 req/hr | ETag conditional requests for polling (304 is free). Exponential backoff on 403/429 |
| GitHub Search API | 30 req/min | Rate-limited queue, max 1 search per scanner per tick |
| Gemini free tier | 15 req/min, 1500/day | NeuroLink failover to Groq when rate limited |
| Groq free tier | 30 req/min, 14400/day | Secondary fallback |

---

## Security Architecture

**Layer 1 — GitHub token boundary.** The token can only access repos the user has been granted access to. No vigilant code can bypass this — it's enforced by GitHub's API.

**Layer 2 — RAG scope filter.** Every `knowledge_documents` query includes `WHERE scope IN ('global', 'repo:{owner}/{name}')`. This is enforced inside `src/rag/index.ts` and cannot be bypassed by calling code.

**Layer 3 — PR comment reading is read-only.** Tool Observer only reads comments; it never posts on behalf of external tools. Posts are made under the user's own GitHub token.

**Layer 4 — Process isolation.** Each user runs their own local process with their own SQLite files. There is no shared state between users.

**Layer 5 — Config file permissions.** `~/.vigilant/config.json` is created with `fs.writeFile` + `fs.chmod(path, 0o600)`. Only the process owner can read it.

---

## Deployment Architecture

vigilant is a CLI tool published to npm. Users install it globally and run it as a local process. For always-on usage, pm2 is the recommended process manager.

```bash
# Install
npm install -g vigilant

# Always-on with pm2 (optional)
pm2 start vigilant -- start --repo org/repo
pm2 save
pm2 startup
```

No server to provision. No infrastructure to manage. The only ongoing cost is the AI API calls, which are free under normal usage on Gemini and Groq free tiers.

---

## Agentic Loop State Machine

Each detected issue becomes a session. Sessions move through stages in one direction only (except `blocked`, which can recover to the previous stage).

```
discovered
    │  Watcher creates session, saves to SQLite
    ▼
investigating
    │  Agent: step 0 (getCurrentTime) → step 1 (sequentialThinking)
    │  → steps 2..N (toolChoice: auto) until goalProgress ≥ 0.7
    ▼
planning
    │  Agent generates structured Plan JSON
    ▼
awaiting_approval          ◀── GATE 1 (human: approve / modify / skip)
    │
    ├── skip ──────────────────────────────────────▶ skipped (terminal)
    │
    ▼ approve
executing
    │  BranchCreator → CodeWriter (per file) → PRCreator
    ▼
pr_created
    │  CIMonitor polls every 60s
    ▼
awaiting_merge             ◀── GATE 2 (human: merge / review / close)
    │
    ├── close ─────────────────────────────────────▶ closed (terminal)
    │
    ▼ merge
merged (terminal)

Any stage can transition to:
blocked ──▶ previous stage (on human recovery or auto-retry)
```

---

## Session State Schema (SQLite)

```sql
CREATE TABLE agent_sessions (
  session_id         TEXT PRIMARY KEY,
  repo_owner         TEXT NOT NULL,
  repo_name          TEXT NOT NULL,
  domain             TEXT NOT NULL,
  issue_type         TEXT NOT NULL,
  stage              TEXT NOT NULL DEFAULT 'discovered',
  severity           TEXT NOT NULL,
  confidence         REAL NOT NULL DEFAULT 0.0,
  source_ref         TEXT NOT NULL,
  iteration_count    INTEGER NOT NULL DEFAULT 0,
  goal_progress      REAL NOT NULL DEFAULT 0.0,
  key_findings       TEXT,          -- JSON array of strings
  data_collected     TEXT,          -- JSON object
  plan               TEXT,          -- JSON Plan object, null until planning stage
  branch_name        TEXT,
  pr_number          INTEGER,
  pr_url             TEXT,
  ci_status          TEXT,
  blocker_reason     TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE watcher_state (
  repo_owner         TEXT NOT NULL,
  repo_name          TEXT NOT NULL,
  scanner_name       TEXT NOT NULL,
  last_etag          TEXT,
  last_checked_at    TEXT NOT NULL,
  PRIMARY KEY (repo_owner, repo_name, scanner_name)
);
```

---

## Knowledge Base Schema (SQLite)

```sql
CREATE TABLE knowledge_documents (
  id                 TEXT PRIMARY KEY,
  scope              TEXT NOT NULL,   -- 'global' or 'repo:owner/name'
  domain             TEXT NOT NULL,
  topic              TEXT NOT NULL,
  source_url         TEXT NOT NULL UNIQUE,
  content            TEXT NOT NULL,
  embedding          BLOB,            -- stored if vector search is enabled
  learned_at         TEXT NOT NULL,
  created_at         TEXT NOT NULL
);

CREATE INDEX idx_knowledge_scope_domain ON knowledge_documents (scope, domain);
```

RAG queries always filter by `scope IN ('global', 'repo:owner/name')` — never by domain alone, never without scope.

---

## Watcher Tick Internals

Each 60-second tick runs five scanners in parallel. Each scanner uses ETag conditional requests — if GitHub returns 304 (not modified), the request costs zero rate limit tokens.

| Scanner | GitHub API endpoint | What triggers an issue |
|---|---|---|
| PR Scanner | `GET /repos/{owner}/{repo}/pulls` | New or updated PR touching domain-relevant file paths |
| Commit Scanner | `GET /repos/{owner}/{repo}/commits` | Push containing a known anti-pattern signature |
| CI Scanner | `GET /repos/{owner}/{repo}/actions/runs` | Failed run whose job name matches domain keywords |
| Dependency Scanner | `GET /repos/{owner}/{repo}/contents/package.json` + GitHub Releases | Payment/security/compliance SDK version behind latest |
| Pattern Scanner | `GET /search/code` | Codebase-wide grep for domain-specific anti-patterns |

Detected issues are deduplicated against existing `agent_sessions` before spawning a new session.

---

## NeuroLink Integration

All AI calls use `@juspay/neurolink` with two providers configured:

```typescript
const neurolink = new NeuroLink({
  providers: [
    { name: 'google', apiKey: config.geminiApiKey },   // primary
    { name: 'groq',   apiKey: config.groqApiKey }      // automatic fallback
  ]
});
```

NeuroLink features used:
- `generate()` with `prepareStep` for the agentic loop
- `rag.addDocument()` and `rag.search()` for the knowledge base
- AutoResearch for idle-mode learning
- MCP tool definitions for the MCP server mode
- Built-in provider failover (no code needed)

---

## MCP Server Tool Definitions

| Tool | Input | Output |
|---|---|---|
| `list_known_issues` | `repo: string` | Array of sessions with stage, severity, issueType |
| `analyze_snippet` | `code: string, domain: string` | Pattern analysis result with matched rules |
| `get_domain_pattern` | `patternName: string, domain: string` | RAG document content |
| `get_session_status` | `sessionId: string` | Full session object |
| `approve_plan` | `sessionId: string` | Confirmation that Gate 1 was triggered |

---

## Domain Pack Architecture

A `DomainPack` is a self-contained configuration object:

```typescript
interface DomainPack {
  id: string;                    // 'payments' | 'security' | 'reliability' | 'compliance'
  name: string;                  // Human-readable label
  patternRules: PatternRule[];   // Search queries + confidence scoring
  filePathPatterns: string[];    // Glob patterns to scope PR scanner
  ciKeywords: string[];          // Job name substrings to match CI scanner
  knowledgeSeedDir: string;      // Path under knowledge/{domain}/
  fixStrategies: Record<IssueType, FixStrategy>;
}
```

The same watcher, agent, executor, and learner run for every domain. Domain affects only:
1. Which files the PR scanner considers relevant
2. Which GitHub Search queries the pattern scanner fires
3. Which CI job names the CI scanner watches
4. Which RAG documents the agent loads on investigation start
5. Which fix strategy template the code writer uses

**v1 ships with four packs:**

| Pack | Issue types | Target audience |
|---|---|---|
| `payments` | 7 | Juspay, Stripe, Razorpay, any checkout team |
| `security` | 5 | Any production backend |
| `reliability` | 5 | Uber, Swiggy, Zomato, any high-traffic service |
| `compliance` | 5 | Goldman Sachs, healthtech, any GDPR-regulated product |

Multiple domains can be active simultaneously via config: `"domains": ["payments", "compliance"]`.

---

## Rate Limit Strategy

| API | Limit | Strategy |
|---|---|---|
| GitHub REST (authenticated) | 5000 req/hr | ETag conditional requests for polling (304 is free). Exponential backoff on 403/429 |
| GitHub Search API | 30 req/min | Rate-limited queue, max 1 search per scanner per tick |
| Gemini free tier | 15 req/min, 1500/day | NeuroLink failover to Groq when rate limited |
| Groq free tier | 30 req/min, 14400/day | Secondary fallback |

---

## Security Architecture

**Layer 1 — GitHub token boundary.** The token can only access repos the user has been granted access to. No vigilant code can bypass this — it's enforced by GitHub's API.

**Layer 2 — RAG scope filter.** Every `knowledge_documents` query includes `WHERE scope IN ('global', 'repo:{owner}/{name}')`. This is enforced inside `src/rag/index.ts` and cannot be bypassed by calling code.

**Layer 3 — Process isolation.** Each user runs their own local process with their own SQLite files. There is no shared state between users.

**Layer 4 — Config file permissions.** `~/.vigilant/config.json` is created with `fs.writeFile` + `fs.chmod(path, 0o600)`. Only the process owner can read it.

---

## Deployment Architecture

vigilant is a CLI tool published to npm. Users install it globally and run it as a local process. For always-on usage, pm2 is the recommended process manager.

```bash
# Install
npm install -g vigilant

# Always-on with pm2 (optional)
pm2 start vigilant -- start --repo org/repo
pm2 save
pm2 startup
```

No server to provision. No infrastructure to manage. The only ongoing cost is the AI API calls, which are free under normal usage on Gemini and Groq free tiers.
