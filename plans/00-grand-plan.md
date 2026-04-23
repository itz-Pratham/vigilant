# vigilant — Grand Plan

This is the master planning document. It is the single source of truth for the entire project. It describes every phase, every component, every integration point, every constraint, and every decision made during design. If something is not in this document and not in a phase doc, it has not been decided yet.

Every developer and AI agent working on this codebase must read this document before touching any code. The phase subdirectories contain the detailed implementation specifications. This document contains the why, the what, and the how at the architecture level.

---

## Project Statement

Software teams introduce subtle bugs in critical code domains — payment flows, security boundaries, API reliability, and regulatory compliance — that pass CI, pass code review, and make it to production. Existing tools (linters, SAST scanners, Dependabot, Snyk, CodeRabbit) catch pieces of the problem — but each tool sees only its own data, has no memory of your team's past decisions, and shouts findings independently without context.

AI coding assistants like Claude Code and Cursor are reactive — they wait for a developer to ask a question. They do not watch. They do not learn from your repo's history. They do not know what your team decided six months ago.

vigilant is the cross-verification intelligence layer. It:
- Runs as a daemon, watching your GitHub repository continuously
- Maintains a living knowledge base built from six sources: current code, git history, team decision docs, user feedback, other GitHub repos, and web research
- Acts as the **observer and verifier** — when Snyk, CodeRabbit, or Dependabot post findings, vigilant synthesises them against your team's context and history, cutting noise and surfacing what actually matters
- When no tools are present (or for private repos where paid tools are unavailable), vigilant acts as the reviewer itself — and then self-reviews its own PRs in an agentic loop before asking for human approval
- Detects both bad patterns AND drift from your team's explicit decisions — but is smart enough to recognise that new patterns may be intentional improvements, not regressions
- Only stops to ask the human two things: does this plan look right, and should I merge this?

---

## The Name

**vigilant** — from Latin *vigilare*, to watch. A synthesis of sentinel (the watcher) and vigil (the act of continuous watchfulness). The agent that never sleeps.

---

## Core Design Decisions

### Decision 1: Local-first, no central server
Every user runs their own vigilant process on their own machine. State lives in SQLite files at `~/.vigilant/`. There is no vigilant SaaS backend. This is not a cost-saving decision — it is a privacy and trust decision. A tool that reads your code and opens PRs must never send your code to a third-party server that is not your chosen AI provider.

### Decision 2: GitHub API is the only data source
No log ingestion, no Kafka, no streaming pipelines. The GitHub API provides everything vigilant needs: PR contents, commit diffs, CI results, file contents, dependency files, PR review comments from third-party tools. It is available to any developer with a GitHub token, requires zero infrastructure, and is rate-limited but manageable with ETag conditional requests.

### Decision 3: Exactly two HITL gates
Plan approval (Gate 1) and merge approval (Gate 2). No other human input. This is a deliberate product decision, not a technical limitation. Between Gate 1 and Gate 2, the agent creates branches, writes code, commits, self-reviews, and opens PRs — entirely on its own.

### Decision 4: Domain packs are pluggable and living
vigilant ships with four seed domain packs (payments, security, reliability, compliance). Each pack is reinforced by six knowledge sources: current code, git history, team decision docs, user feedback, other GitHub repos, and web research. The domain pack provides the starting vocabulary; the knowledge base makes it specific to your team over time.

### Decision 5: NeuroLink is the only AI abstraction
`@juspay/neurolink` handles all AI calls, provider failover, RAG, AutoResearch, and MCP server tooling. No model provider SDK is called directly.

### Decision 6: SQLite replaces Redis
The production agentic loop at Juspay uses Redis for session state (8-day TTL). vigilant uses SQLite for the same purpose. For a local CLI tool, SQLite is the correct choice. The session state schema is identical — only the storage layer differs.

### Decision 7: Third-party tool integration is optional
Snyk, CodeRabbit, and Dependabot are free for public repos but paid for private repos (Snyk: $25/dev/month, CodeRabbit: $19/dev/month). vigilant does not require any of them. When they are present (detected via PR review comments on `github.com`), vigilant reads their findings and synthesises them with its own knowledge. When they are absent, vigilant acts as the reviewer itself and self-reviews its own PRs using its knowledge base before Gate 1.

### Decision 8: Self-review loop before Gate 1
When vigilant opens a fix PR, it does not immediately go to Gate 1. It runs a self-review agentic pass: reads its own PR diff, applies its domain knowledge, checks for regressions it may have introduced. If issues are found, it pushes corrections and re-reviews. Maximum 3 self-review iterations before escalating to Gate 1 regardless. This means every Gate 1 prompt is for a PR that has already been cross-verified.

### Decision 9: Drift detection is intelligent, not rigid
When vigilant detects that code diverges from a known pattern or team decision, it does not automatically flag it as wrong. It first asks: was this intentional? It checks git history (was there a team discussion?), decision docs (was this explicitly decided?), and the broader knowledge base (is the new pattern considered better by the community?). If intentional and better: learn it, update knowledge base, inform the team. If accidental: flag as regression.

---

## Project Goal

Build and publish `vigilant` as an npm package. Users install it with `npm install -g vigilant`, run `vigilant init` to configure, and `vigilant start --repo org/repo` to begin watching. The daemon runs indefinitely, finds issues, investigates them, writes fixes, and opens PRs. The human approves plans and clicks merge.

The MCP server mode (`vigilant serve`) exposes vigilant's intelligence to Cursor and Claude Code, making its knowledge and findings available as editor context.

---

## Success Criteria (Full Project)

- `npm install -g vigilant && vigilant init` completes in under 90 seconds
- `vigilant start --repo org/repo` runs indefinitely without crashing or memory leaks
- The watcher correctly detects all issue types for the active domain pack
- The agent correctly investigates issues and produces accurate, actionable plans
- Gate 1 plan approval renders a clear, complete plan and responds correctly to all three choices
- The executor creates real branches, writes real code, and opens real PRs on GitHub
- CI monitoring correctly detects pass/fail and triggers Gate 2 or blocks appropriately
- Gate 2 merge approval correctly calls the GitHub merge API
- Learning mode runs on every idle tick and grows the knowledge base over time
- MCP server connects to Cursor and returns correct data from all five tools
- Domain packs are switchable via config with no code changes
- All state survives process restarts (crash recovery works at every stage)
- The tool works on macOS, Linux, and Windows (WSL)
- Normal usage stays within free tier limits of Gemini and Groq

---

## Full Architecture

### Component Map

```
vigilant process
│
├── CLI (Commander.js)
│   └── Commands: init, start, status, session, approve, learn, serve, config
│
├── Watcher (daemon loop, setInterval)
│   ├── PR Scanner          → new/updated PRs touching domain files
│   ├── Commit Scanner      → recent pushes with anti-pattern signatures
│   ├── CI Scanner          → failed GitHub Actions runs on domain tests
│   ├── Dependency Scanner  → package.json SDKs vs latest releases
│   └── Pattern Scanner     → GitHub Search API grep over entire codebase
│
├── Tool Observer (cross-verification)
│   ├── reads Snyk review comments from PR threads
│   ├── reads CodeRabbit review comments from PR threads
│   ├── reads Dependabot alerts and PR descriptions
│   └── synthesises all tool findings + vigilant's own knowledge
│       → one unified, context-aware review comment per PR
│
├── Agent (NeuroLink agentic loop, per session)
│   ├── State Manager       → SQLite load/save after every step
│   ├── prepareStep         → step 0: getCurrentTime, step 1: sequentialThinking
│   ├── Tools               → readFile, searchCode, ragSearch, readPRDiff, searchWeb
│   │                          readGitHistory, readTeamDecisions
│   └── Plan Generator      → structured Plan JSON from investigation findings
│
├── Self-Review Loop (before Gate 1, max 3 iterations)
│   ├── reads vigilant's own PR diff
│   ├── applies domain knowledge + learned patterns
│   ├── checks for regressions introduced by the fix
│   └── pushes corrections if issues found → re-review until clean
│
├── HITL
│   ├── Gate 1              → plan approval terminal UI (after self-review passes)
│   └── Gate 2              → merge approval terminal UI
│
├── Executor (fully autonomous after Gate 1)
│   ├── Branch Creator      → GitHub Refs API
│   ├── Code Writer         → NeuroLink generate + GitHub Contents API
│   ├── PR Creator          → GitHub PRs API
│   └── CI Monitor          → GitHub Actions API polling
│
├── Learner (idle mode + continuous)
│   ├── Topic Queue         → round-robin research topics per domain
│   ├── Git History Reader  → learns from YOUR repo's past commits + merged PRs
│   ├── GitHub Researcher   → other repos' merged PRs, security advisories
│   ├── Web Researcher      → NeuroLink AutoResearch (blogs, CVEs)
│   └── Decision Doc Reader → reads team ADRs, design docs, decision.md
│
├── MCP Server (HTTP transport)
│   └── Tools: list_known_issues, analyze_snippet, get_domain_pattern,
│              get_session_status, approve_plan
│
├── Knowledge Base (six sources, one store)
│   ├── Source 1: current codebase patterns
│   ├── Source 2: git history of YOUR repo
│   ├── Source 3: team decision docs (ADRs, decision.md)
│   ├── Source 4: user feedback (corrections, approvals, overrides)
│   ├── Source 5: other GitHub repos (idle learning)
│   └── Source 6: web research (blogs, CVEs, advisories)
│
├── Domain Packs
│   ├── payments            → 7 issue types, payment knowledge seeds
│   ├── security            → 5 issue types, security knowledge seeds
│   ├── reliability         → 5 issue types, reliability knowledge seeds
│   └── compliance          → 5 issue types, compliance knowledge seeds
│
└── lib
    ├── GitHub client       → @octokit/rest, authenticated, rate-limit aware
    ├── Logger              → structured, session-scoped, secret-stripping
    ├── Config              → load/validate/save ~/.vigilant/config.json
    ├── DB                  → SQLite connections for state.db + knowledge.db
    ├── Constants           → all string literals centralised
    └── Errors              → typed error hierarchy
```

### Data Flow (Happy Path — With Tool Integration)

```
Watcher tick (every 60s)
  → PR Scanner finds PR #47 touching checkout/payment.ts
  → Pattern match: createPayment() without idempotencyKey
  → Tool Observer: reads Snyk comment ("no issues") + CodeRabbit comment
  → DetectedIssue: { issueType: MISSING_IDEMPOTENCY, severity: HIGH }
  → Dedup check: no existing session → proceed
  → agent.startSession(issue)

Agent Session (SESS_vigilant_MISSING_IDEMPOTENCY_org_repo_001)
  → step 0: getCurrentTime
  → step 1: sequentialThinking
  → step 2: readFile("checkout/payment.ts")
  → step 3: ragSearch("idempotency payment best practice") → 3 global docs
  → step 4: readGitHistory("checkout/payment.ts") → last 20 commits
             → finds: team added idempotency to 3 other payment calls in Jan
  → step 5: readTeamDecisions() → decision.md says "all payment mutations need idempotency"
  → goalProgress: 0.95 → Plan generated with full context
  → stage: awaiting_self_review

Self-Review Loop (max 3 iterations)
  → reads own planned diff
  → domain check: uuid import missing? → yes → adds to plan
  → re-checks: clean → stage: awaiting_approval

Gate 1 (terminal UI)
  → Plan + git history context + team decision reference displayed
  → Human types [a] → stage: executing

Executor (fully autonomous)
  → createBranch("vigilant/fix/idempotency-pr47")
  → writeFile: checkout/payment.ts with idempotencyKey + uuid import
  → createPR — Snyk scans it, CodeRabbit reviews it
  → Tool Observer reads their feedback → all clear
  → monitorCI → passes → stage: awaiting_merge

Gate 2 → Human merges → stage: merged
→ Knowledge updated: "team confirmed idempotency fix pattern"
```

### Data Flow (Fallback — No Third-Party Tools)

```
Same watcher detection as above

Agent Session
  → same investigation steps
  → additionally: readGitHistory shows this was already fixed twice before
    → knowledge: "this is a recurring regression in this repo"
  → Plan includes regression context in PR body

Self-Review Loop (vigilant reviews its OWN PR, tools absent)
  → reads own diff via GitHub API
  → NeuroLink: "does this fix introduce any new issues?"
  → finds: no test added for new idempotency logic
  → adds test suggestion to PR body comment
  → re-checks: satisfied after iteration 2

Gate 1 → Human approves → Executor runs → Gate 2 → merged
```

---

## SQLite Schema (Complete)

### state.db

```sql
-- Agent sessions: one row per detected issue
CREATE TABLE IF NOT EXISTS agent_sessions (
  session_id         TEXT PRIMARY KEY,
  repo_owner         TEXT NOT NULL,
  repo_name          TEXT NOT NULL,
  domain             TEXT NOT NULL,
  issue_type         TEXT NOT NULL,
  stage              TEXT NOT NULL DEFAULT 'discovered',
  severity           TEXT NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  confidence         REAL NOT NULL DEFAULT 0.0 CHECK (confidence >= 0 AND confidence <= 1),
  source_ref         TEXT NOT NULL,
  evidence           TEXT NOT NULL DEFAULT '[]',  -- JSON string[]
  iteration_count    INTEGER NOT NULL DEFAULT 0,
  goal_progress      REAL NOT NULL DEFAULT 0.0,
  key_findings       TEXT NOT NULL DEFAULT '[]',  -- JSON string[]
  data_collected     TEXT NOT NULL DEFAULT '{}',  -- JSON object
  plan               TEXT,                         -- JSON Plan, null until planning done
  branch_name        TEXT,
  pr_number          INTEGER,
  pr_url             TEXT,
  pr_head_sha        TEXT,
  ci_status          TEXT CHECK (ci_status IN ('pending','running','passed','failed',NULL)),
  executor_step      TEXT,  -- 'branch_created' | 'files_written' | 'pr_created'
  blocker_reason     TEXT,
  stall_count        INTEGER NOT NULL DEFAULT 0,
  run_number         INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sessions_repo
  ON agent_sessions (repo_owner, repo_name);

CREATE INDEX IF NOT EXISTS idx_sessions_stage
  ON agent_sessions (stage);

CREATE INDEX IF NOT EXISTS idx_sessions_dedup
  ON agent_sessions (repo_owner, repo_name, issue_type, source_ref);

-- Watcher state: ETag cache and last-checked timestamps per scanner
CREATE TABLE IF NOT EXISTS watcher_state (
  repo_owner         TEXT NOT NULL,
  repo_name          TEXT NOT NULL,
  scanner_name       TEXT NOT NULL,
  last_etag          TEXT,
  last_checked_at    TEXT NOT NULL,
  PRIMARY KEY (repo_owner, repo_name, scanner_name)
);

-- Topic queue for learner mode
CREATE TABLE IF NOT EXISTS learning_topics (
  id                 TEXT PRIMARY KEY,
  domain             TEXT NOT NULL,
  topic              TEXT NOT NULL,
  search_query       TEXT NOT NULL,
  last_researched_at TEXT,
  research_count     INTEGER NOT NULL DEFAULT 0
);
```

### knowledge.db

```sql
-- Knowledge documents: every learned fact, scoped to repo or global
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id                 TEXT PRIMARY KEY,
  scope              TEXT NOT NULL,   -- 'global' | 'repo:owner/name'
  domain             TEXT NOT NULL,
  topic              TEXT NOT NULL,
  source_url         TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  content            TEXT NOT NULL,
  key_points         TEXT NOT NULL DEFAULT '[]',  -- JSON string[] (extracted by AutoResearch)
  confidence         REAL NOT NULL DEFAULT 1.0,
  learned_at         TEXT NOT NULL,
  created_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_scope_domain
  ON knowledge_documents (scope, domain);

CREATE INDEX IF NOT EXISTS idx_knowledge_topic
  ON knowledge_documents (topic);

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_url
  ON knowledge_documents (source_url);
```

---

## TypeScript Types (Master Reference)

All types live in their phase's `types.ts` file. This section is the canonical reference.

```typescript
// ── Config ──────────────────────────────────────────────────────────
type VigilantConfig = {
  githubToken: string;
  geminiApiKey?: string;
  groqApiKey?: string;
  openaiApiKey?: string;
  defaultRepos: string[];
  watchIntervalSeconds: number;
  domains: string[];
  maxIterations: number;
};

// ── Watcher ──────────────────────────────────────────────────────────
type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

type DetectedIssue = {
  issueType: string;
  severity: Severity;
  confidence: number;
  sourceRef: string;
  evidence: string[];
  domain: string;
  repoOwner: string;
  repoName: string;
};

type PatternRule = {
  id: string;
  issueType: string;
  description: string;
  searchQuery: string;
  filePathPattern?: string;
  severity: Severity;
  confidenceScore: number;
};

type ScanResult = {
  scanner: string;
  issues: DetectedIssue[];
  newEtag?: string;
};

// ── Agent ─────────────────────────────────────────────────────────────
type IssueStage =
  | 'discovered' | 'investigating' | 'planning'
  | 'awaiting_self_review' | 'self_reviewing' | 'awaiting_approval'
  | 'executing' | 'pr_created' | 'awaiting_merge' | 'merged'
  | 'skipped' | 'closed' | 'blocked';

// External tool findings read from PR review comments
type ExternalToolFinding = {
  tool: 'snyk' | 'coderabbit' | 'dependabot' | 'github_security';
  comment: string;
  severity?: string;
  file?: string;
  line?: number;
  prNumber: number;
};

type FileChange = {
  path: string;
  description: string;
  before: string;
  after: string;
  lineHint?: number;
};

type Plan = {
  summary: string;
  severity: Severity;
  confidence: number;
  rootCause: string;
  changes: FileChange[];
  branchName: string;
  prTitle: string;
  prBodyMarkdown: string;
  testSuggestions: string[];
};

type IssueSession = {
  sessionId: string;
  repoOwner: string;
  repoName: string;
  domain: string;
  issueType: string;
  stage: IssueStage;
  severity: Severity;
  confidence: number;
  sourceRef: string;
  evidence: string[];
  iterationCount: number;
  goalProgress: number;
  keyFindings: string[];
  dataCollected: Record<string, unknown>;
  plan: Plan | null;
  branchName: string | null;
  prNumber: number | null;
  prUrl: string | null;
  prHeadSha: string | null;
  ciStatus: 'pending' | 'running' | 'passed' | 'failed' | null;
  executorStep: 'branch_created' | 'files_written' | 'pr_created' | null;
  blockerReason: string | null;
  stallCount: number;
  runNumber: number;
  createdAt: string;
  updatedAt: string;
};

// ── Domain Packs ──────────────────────────────────────────────────────
type FixStrategy = {
  issueType: string;
  promptHint: string;      // appended to the code-writer NeuroLink prompt
  exampleBefore: string;
  exampleAfter: string;
};

type DomainPack = {
  id: string;
  name: string;
  description: string;
  issueTypes: string[];
  patternRules: PatternRule[];
  knowledgeSeedDir: string;
  fixStrategies: FixStrategy[];
  ciKeywords: string[];        // job name patterns for CI scanner
  filePathPatterns: string[];  // repo path patterns for PR/commit scanner
};

// ── MCP Server ────────────────────────────────────────────────────────
type MCPToolName =
  | 'list_known_issues'
  | 'analyze_snippet'
  | 'get_domain_pattern'
  | 'get_session_status'
  | 'approve_plan';
```

---

## Phases Overview

| Phase | Name | Primary Deliverable | Depends On |
|---|---|---|---|
| 1 | Foundation | Runnable CLI, config wizard, SQLite, logger | — |
| 2 | Watcher | GitHub scanners, pattern registry, daemon loop | 1 |
| 3 | Agent | Agentic loop, state machine, tools, plan generation | 1, 2 |
| 4 | HITL | Gate 1 + Gate 2 terminal UI, status/session/approve commands | 3 |
| 5 | Executor | Branch, code, PR, CI — fully autonomous | 3, 4 |
| 6 | Learner | Idle research, RAG growth, knowledge dedup | 1, 3 |
| 7 | MCP Server | HTTP MCP server, 5 tools, Cursor/Claude Code integration | 3, 5, 6 |
| 8 | Domain Packs | Pluggable domain architecture, 4 domain packs (payments, security, reliability, compliance) | 2, 3 |

Phase documents are in `plans/phase-N-name/`. Each phase directory contains:
- `00-overview.md` — goal, scope, success criteria
- `01-types.md` — all TypeScript types for this phase
- `02-*.md` through `09-*.md` — one file per major component
- `10-integration.md` — how this phase wires into the rest of the system
- `checklist.md` — implementation tracking with every task listed

---

## Phase 1 — Foundation

**Goal:** Everything needed for the project to run. No AI, no GitHub calls. Just the skeleton.

**Key deliverables:**
- `package.json`: all dependencies declared, `bin.vigilant` pointing to compiled entry, `prepublishOnly: tsc`, `engines.node: >=20`
- `tsconfig.json`: `strict: true`, `paths: {"@/*": ["./src/*"]}`, `outDir: dist`, `target: ES2022`, `module: Node16`, `moduleResolution: Node16`
- `vigilant init`: interactive wizard (inquirer), validates token format, saves `~/.vigilant/config.json` at `chmod 0o600`, runs DB migrations
- `vigilant config show` / `vigilant config set`
- SQLite schema migrations run on startup: both `state.db` and `knowledge.db`
- Structured logger: every line has `[ISO_TIMESTAMP] [LEVEL] [SESSION_OR_DAEMON] message`
- Typed error classes: `VigilantError`, `GitHubAPIError`, `AIProviderError`, `ConfigError`, `ExecutorError`
- All string constants in `src/lib/constants.ts`
- All CLI commands stubbed (help text works, bodies come in later phases)

**Phase directory:** `plans/phase-1-foundation/` — 11 files + checklist

---

## Phase 2 — Watcher

**Goal:** A daemon that runs on a configurable interval, scans GitHub for domain-specific issues, and hands them to the agent.

**Key deliverables:**
- Five scanners: PR, commit, CI failure, dependency drift, code pattern
- Pattern registry: per-domain `PatternRule[]` loaded from active domain pack
- ETag conditional requests for every polling call (304 = zero rate limit cost)
- Deduplication against existing active sessions in SQLite
- Exponential backoff on 403/429 responses
- `vigilant start` command wires everything together

**GitHub API calls used:**
- `GET /repos/{owner}/{repo}/pulls` — PR scanner
- `GET /repos/{owner}/{repo}/commits` — commit scanner
- `GET /repos/{owner}/{repo}/actions/runs` — CI scanner
- `GET /repos/{owner}/{repo}/contents/package.json` — dependency scanner
- `GET /search/code` — pattern scanner

**Phase directory:** `plans/phase-2-watcher/` — 11 files + checklist

---

## Phase 3 — Agent

**Goal:** The agentic loop. Takes a `DetectedIssue`, investigates it autonomously using NeuroLink, produces a `Plan`. This is the cognitive core.

**Key deliverables:**
- Full `IssueSession` state machine with 11 stages
- `AgentStateManager`: SQLite load/save after every iteration — crash-resumable
- `prepareStep` enforcement: step 0 = `getCurrentTime`, step 1 = `sequentialThinking` — copied from Lighthouse `executor.ts`
- Five agent tools: `readFile`, `searchCode`, `ragSearch`, `readPRDiff`, `searchWeb`
- Main loop: runs until `goalProgress >= 0.9` or `iterationCount >= maxIterations`
- Stall detection: if `goalProgress` unchanged for 3 consecutive iterations → mark `blocked`
- Plan generator: structured `Plan` JSON extracted via NeuroLink with JSON output mode
- Session ID format: `SESS_vigilant_{ISSUE_TYPE}_{owner}_{repo}_{runNumber padded to 3}`

**NeuroLink configuration:**
```typescript
const neurolink = new NeuroLink({
  providers: [
    { name: 'google', apiKey: config.geminiApiKey },
    { name: 'groq', apiKey: config.groqApiKey }
  ],
  rag: { db: knowledgeDb }
});
```

**Phase directory:** `plans/phase-3-agent/` — 11 files + checklist

---

## Phase 4 — HITL

**Goal:** Two terminal UI gates. Gate 1: plan approval. Gate 2: merge approval. Status and session inspect commands.

**Key deliverables:**
- Gate 1 `PlanApprovalPrompt`: chalk-rendered box with severity colour coding, inquirer select: approve/modify/skip
- Gate 2 `MergeApprovalPrompt`: PR info + CI status, inquirer select: merge/review/close
- Modification flow: open inquirer editor, re-generate plan, re-render, re-prompt
- `vigilant status`: table of all sessions with stage, severity, domain, time-ago
- `vigilant session <id>`: full detail view including plan and executor progress
- `vigilant approve <id>`: programmatic Gate 1 approve (for CI/CD pipelines)

**Colour coding (chalk):** CRITICAL = red bold, HIGH = yellow bold, MEDIUM = blue, LOW = grey

**Phase directory:** `plans/phase-4-hitl/` — 11 files + checklist

---

## Phase 5 — Executor

**Goal:** Fully autonomous post-approval execution. Creates branch, writes every file change, opens PR, monitors CI. Zero human input.

**Key deliverables:**
- `BranchCreator`: `POST /repos/{owner}/{repo}/git/refs` from default branch SHA
- `CodeWriter`: read file (get SHA), NeuroLink.generate(new content), write back via GitHub Contents API — per FileChange
- `PRCreator`: structured PR body with session ID, root cause, change list, test suggestions
- `CIMonitor`: polls `GET /repos/{owner}/{repo}/actions/runs?head_sha={sha}` every 60s, 30-minute timeout
- `executorStep` field in SQLite for partial failure recovery (skip already-done steps on restart)

**GitHub API calls used:**
- `GET /repos/{owner}/{repo}/git/ref/heads/{branch}` — get default branch SHA
- `POST /repos/{owner}/{repo}/git/refs` — create branch
- `GET /repos/{owner}/{repo}/contents/{path}?ref={branch}` — read file + SHA
- `PUT /repos/{owner}/{repo}/contents/{path}` — write file
- `POST /repos/{owner}/{repo}/pulls` — create PR
- `GET /repos/{owner}/{repo}/actions/runs` — CI monitoring
- `PUT /repos/{owner}/{repo}/pulls/{number}/merge` — merge (Gate 2)

**Phase directory:** `plans/phase-5-executor/` — 11 files + checklist

---

## Phase 6 — Learner

**Goal:** When the watcher finds no new issues, run one research job using NeuroLink AutoResearch, grow the knowledge base, make the next investigation smarter.

**Key deliverables:**
- `learning_topics` table in SQLite: round-robin queue of topics per domain
- `GitHubResearcher`: GitHub Search API (merged PRs, issues), GitHub Security Advisories API
- `WebResearcher`: NeuroLink AutoResearch — fetches source, follows links (depth 2), synthesises
- `RAGStore`: wraps NeuroLink `addDocument()` with mandatory scope tagging + URL deduplication
- `vigilant learn --topic <topic>`: manual one-off research job

**Source priority (round-robin):**
1. GitHub merged PRs matching `{domain} best practice fix`
2. GitHub Security Advisories for domain-relevant packages
3. Engineering blogs (Stripe, Razorpay, Juspay, Netflix, Uber engineering)
4. CVE databases for payment/security packages
5. GitHub trending repos tagged with domain keywords

**Phase directory:** `plans/phase-6-learner/` — 11 files + checklist

---

## Phase 7 — MCP Server

**Goal:** An MCP HTTP server that exposes vigilant's intelligence to Cursor, Claude Code, and any MCP-compatible client. Users add a one-line config entry and vigilant becomes part of their AI editor context.

**Key deliverables:**
- MCP server using `@modelcontextprotocol/sdk` HTTP transport, localhost only by default
- Five tools: `list_known_issues`, `analyze_snippet`, `get_domain_pattern`, `get_session_status`, `approve_plan`
- `vigilant serve --port 3001` command
- Installation snippets for Cursor (`~/.cursor/mcp.json`) and Claude Desktop in `docs/deployment.md`

**Phase directory:** `plans/phase-7-mcp-server/` — 11 files + checklist

---

## Phase 8 — Domain Packs

**Goal:** A clean, pluggable domain pack architecture. Switching domains requires only a config change, no code change.

**Key deliverables:**
- `DomainPack` interface with `id`, `name`, `issueTypes`, `patternRules`, `knowledgeSeedDir`, `fixStrategies`, `ciKeywords`, `filePathPatterns`
- Domain pack loader: reads enabled domains from config, loads pattern rules and knowledge seeds
- `payments` pack: 7 issue types with pattern rules, knowledge seeds, fix strategies
- `security` pack: 5 issue types
- `reliability` pack: 5 issue types
- `compliance` pack: 5 issue types
- Knowledge seeds in `knowledge/{domain}/` are loaded into the RAG store on first start per repo
- `--domain` flag on `vigilant start` to override config

**Payments domain issue types:**
- `MISSING_IDEMPOTENCY` — createPayment/createCharge without idempotencyKey
- `WEBHOOK_NO_SIGNATURE` — webhook handler without HMAC verification
- `SILENT_ERROR_SWALLOW` — catch(e) {} or catch(e) { return } on payment calls
- `RETRY_ON_TERMINAL_ERROR` — retrying on INSUFFICIENT_FUNDS, CARD_DECLINED, etc.
- `SDK_VERSION_DRIFT` — payment SDK in package.json behind latest release by ≥1 minor version
- `CI_PAYMENT_FAILURE` — payment/checkout test suite failed in recent GitHub Actions run
- `MISSING_TIMEOUT` — payment API call without explicit timeout configuration

**Security domain issue types:**
- `SECRET_IN_CODE` — API key, token, or password literal found in source file
- `MISSING_AUTH_CHECK` — route handler with no authentication middleware
- `SQL_INJECTION_RISK` — raw string interpolation into a SQL query
- `PII_IN_LOGS` — email, phone, or card number passed to a logger
- `UNVALIDATED_INPUT` — external user input passed to a function without schema validation

**Reliability domain issue types:**
- `MISSING_TIMEOUT` — outbound HTTP call with no timeout configured
- `NO_CIRCUIT_BREAKER` — external service call with no opossum / circuit-breaker pattern
- `UNHANDLED_PROMISE` — floating promise (no `.catch()`, no `await`, no `void`)
- `MISSING_RETRY_LOGIC` — transient network call with no retry on 5xx
- `N_PLUS_ONE_QUERY` — ORM `find` inside a loop without batch/include

**Compliance domain issue types:**
- `PII_IN_LOGS` — personal data (name, email, phone, card) written to log output
- `UNENCRYPTED_PII_STORAGE` — sensitive field stored as plaintext in DB column or config
- `MISSING_AUDIT_TRAIL` — mutation (write/delete) on a sensitive record with no audit log entry
- `GDPR_RIGHT_TO_DELETE_GAP` — user data entity with no delete/anonymise pathway
- `MISSING_DATA_RETENTION_POLICY` — table or store with sensitive data and no TTL or cleanup job

**Target audience by domain:**

| Domain | Primary audience |
|---|---|
| `payments` | Juspay, Stripe, Razorpay, any checkout / billing team |
| `security` | Any production backend — FAANG, fintech, SaaS |
| `reliability` | High-traffic services — Uber, Swiggy, Zomato, Ola, Swish |
| `compliance` | Regulated industries — Goldman Sachs, any GDPR-scoped product, healthtech |

Multiple domains can be enabled simultaneously: `"domains": ["payments", "compliance"]`.

**Phase directory:** `plans/phase-8-domain-packs/` — 11 files + checklist

---

## Non-Goals (v1)

- No web dashboard or browser UI of any kind
- No Docker or containerisation
- No Kafka or streaming pipelines
- No central vigilant server or SaaS backend
- No real-time log ingestion (OpenObserve, Kibana, Elastic) — GitHub API only
- No blockchain features
- No GitLab or Bitbucket support in v1 — GitHub only
- No auto-merge without human Gate 2 approval unless explicitly configured by user

---

## Future Scope (v2+)

These are intentionally out of scope for v1 but represent a natural growth path. They should be kept in mind when making architectural decisions to avoid building walls.

### Additional Domain Packs

The `DomainPack` interface makes every new domain a configuration-only addition. No engine changes required. Planned v2 packs:

| Domain | What it finds | Target audience |
|---|---|---|
| `performance` | N+1 queries, synchronous file I/O in hot paths, missing DB indexes on filtered columns, unbounded memory growth in loops | Any high-traffic backend — Uber, Flipkart, FAANG |
| `accessibility` | Missing ARIA labels, images without `alt`, keyboard-unreachable interactive elements, missing `role` attributes, form fields without `label` | Product companies with public-facing UIs |
| `testing` | Untested critical paths (payment, auth, deletion), brittle mocks that never fail, missing edge case coverage, test files importing from `src/` via relative paths across too many levels | Any team with a CI pipeline |
| `infrastructure` | Hardcoded IP addresses, missing graceful shutdown handlers, no health check endpoint, secrets in environment variable names, missing liveness/readiness probes | DevOps-aware teams, cloud-native backends |

### Platform Extensions

- **GitLab support** — swap Octokit for GitLab API client, same `WatcherAdapter` interface
- **Bitbucket support** — same pattern
- **Web dashboard** — read-only view of sessions, plans, and learning topics. Never takes actions. Served locally on `localhost:3000` by the daemon
- **Team mode** — shared `knowledge.db` synced via a private GitHub repo (no central server — git-based sync)
- **Custom domain pack registry** — `vigilant pack install <npm-package>` to install community domain packs
- **Slack / webhook notifications** — notify on Gate 1 or Gate 2 instead of requiring terminal presence

---

## Dependency List (Complete)

```json
{
  "dependencies": {
    "@juspay/neurolink": "latest",
    "@modelcontextprotocol/sdk": "latest",
    "@octokit/rest": "^20.0.0",
    "better-sqlite3": "^9.0.0",
    "chalk": "^5.0.0",
    "commander": "^12.0.0",
    "inquirer": "^9.0.0",
    "ora": "^8.0.0",
    "cli-table3": "^0.6.0",
    "date-fns": "^3.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.0.0",
    "@types/inquirer": "^9.0.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint": "^9.0.0"
  }
}
```

---

## Rate Limit Budget

Total GitHub API budget: 5000 authenticated requests per hour.

| Operation | Frequency | Requests per hour |
|---|---|---|
| Watcher: PR scanner (ETag) | Every 60s | 60 (0 if no change, 304) |
| Watcher: Commit scanner (ETag) | Every 60s | 60 (0 if no change) |
| Watcher: CI scanner (ETag) | Every 60s | 60 (0 if no change) |
| Watcher: Dependency scanner (ETag) | Every 5 min | 12 |
| Watcher: Pattern scanner (Search API) | Every 5 min | 12 (Search: 30/min limit) |
| Agent: readFile tool calls | Per session | ~10 per active session |
| Agent: searchCode calls | Per session | ~5 per active session |
| Executor: file reads + writes | Per session | ~10 per file changed |
| Executor: CI monitoring | Every 60s per PR | 60 per open PR |
| Learner: GitHub research | One job per idle tick | ~10 per idle tick |
| **Total (normal, 1 active session)** | — | **~300/hr** |
| **Total (heavy, 5 active sessions)** | — | **~800/hr** |

Well within the 5000/hr limit. ETag responses (304) are not counted.

---

## Session ID Format

```
SESS_vigilant_{ISSUE_TYPE}_{OWNER}_{REPO}_{RUN}

Examples:
SESS_vigilant_MISSING_IDEMPOTENCY_myorg_myrepo_001
SESS_vigilant_WEBHOOK_NO_SIGNATURE_myorg_myrepo_001
SESS_vigilant_SQL_INJECTION_risk_corp_backend_003
```

`{RUN}` is a 3-digit zero-padded integer. It increments each time a new session is created for the same `issueType + sourceRef` after a previous one was resolved (merged/skipped/closed). This allows full audit history.

---

## Deployment Path

1. Develop and test locally
2. Run `npm run build` — TypeScript compiles to `dist/`
3. Run `npm publish --access public` — publishes to npm registry
4. Users: `npm install -g vigilant` then `vigilant init`
5. Always-on: `pm2 start vigilant -- start --repo org/repo`
6. No server. No cloud. No infrastructure.

