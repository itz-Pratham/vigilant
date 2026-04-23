# vigilant

> The cross-verification intelligence layer for GitHub repositories.

vigilant watches your GitHub repository 24/7 as a three-role system: it reads and synthesises the findings of tools like Snyk, CodeRabbit, and Dependabot with your team's own git history and decision docs; it autonomously investigates issues, writes fixes, and self-verifies its own PRs before asking you to approve; and when idle, it grows a knowledge base from six sources so every future investigation is smarter.

Human input is required at exactly two moments: when it shows you the plan, and when the PR is ready to merge.

---

## The Problem

Your repo already has Snyk, CodeRabbit, and Dependabot. They each post a review comment and move on. No tool reads the other tools' findings. No tool knows that your team explicitly fixed this exact issue in January and wrote a decision doc about it. No tool adjusts its verdict based on your team's real patterns. Every engineer still has to manually reconcile three separate tool outputs with their own knowledge of the codebase.

And when no tools are present — because your repo is private and Snyk costs $25/dev/month — you're back to manual review.

---

## What vigilant Does

**Synthesises tool findings with team context.** When Snyk and CodeRabbit post on a PR, vigilant reads both comments, checks your git history and team decision docs, and posts one unified, actionable comment — not three separate opinions.

**Falls back gracefully when tools are absent.** If no external tools are present, vigilant does the full review itself. Same quality. No additional cost. No configuration needed.

**Investigates autonomously.** When an issue is found, an agentic loop reads the relevant code, searches the knowledge base, reads git history, reads team decisions, and reasons about root cause — without human input.

**Self-verifies before asking you.** Before Gate 1, vigilant reads its own planned PR diff, checks for regressions, verifies team patterns, and pushes corrections if needed (max 3 iterations). You never see a Gate 1 prompt for a PR vigilant hasn't already cross-checked.

**Executes completely.** After approval, vigilant creates the branch, writes the code, commits, and opens a PR — all via the GitHub API. No human involvement until Gate 2.

**Learns from six sources.** Current code, your team's git history, team decision docs, your feedback, other GitHub repos, and web research. Every idle tick makes the next investigation smarter.

---

## The Cross-Verification Loops

### Loop A — Human PR
```
PR opened
  → Snyk reviews, CodeRabbit reviews (if present)
  → vigilant reads their comments + your git history + decision docs
  → one unified comment on the PR with full team context
```

### Loop B — vigilant's own fix PR
```
Issue detected → Agent investigates → Plan generated
  → Self-review loop (max 3 iterations): checks regressions, team patterns, missing tests
  → Gate 1: you approve a PR that vigilant has already verified
  → Executor opens PR → Snyk/CodeRabbit review vigilant's code (if present)
  → Gate 2: merge
```

### Loop C — Idle learning
```
No new issues → Learner picks a topic
  → reads your git history, other repos, CVEs, engineering blogs
  → knowledge.db grows → next investigation is smarter
```

---

## Domain Packs

vigilant is not limited to one domain. You enable the domains relevant to your codebase.

| Domain | What it finds |
|---|---|
| `payments` | Missing idempotency keys, unverified webhooks, silent error swallowing on payment calls, retrying terminal errors, outdated payment SDK versions |
| `security` | Secrets in code, SQL injection risks, missing auth checks, PII in logs, unvalidated inputs |
| `reliability` | Missing timeouts, no circuit breakers, unhandled promise rejections, missing retry logic, N+1 query patterns |
| `compliance` | PII written to logs, unencrypted PII in DB storage, mutations on sensitive records without audit logs, no GDPR deletion pathway, tables with sensitive data and no retention/TTL policy |

Each domain pack is a configuration: a set of patterns to search for, a seed knowledge base, and fix strategies. Same agent engine, different lens.

---

## Installation

```bash
npm install -g vigilant
```

Then run the setup wizard:

```bash
vigilant init
```

The wizard asks for your GitHub token and AI provider key, then stores everything in `~/.vigilant/config.json` (owner-read-only).

---

## Commands

```bash
vigilant init                              # first-time setup wizard
vigilant start --repo org/repo            # start watching a repo
vigilant start --repo org/repo --domain security  # with a specific domain
vigilant status                            # show all active sessions
vigilant session <sessionId>              # inspect one session in detail
vigilant approve <sessionId>              # approve a plan from another terminal
vigilant learn --topic "webhook security" # run a one-off research job
vigilant serve --port 3001               # start MCP server for Cursor/Claude Code
vigilant config show                      # show current config (keys masked)
vigilant config set githubToken=...       # update a config value
```

---

## MCP Integration

After installing, add to your Cursor or Claude Desktop config:

```json
{
  "mcpServers": {
    "vigilant": {
      "command": "vigilant",
      "args": ["serve"]
    }
  }
}
```

Restart Cursor. vigilant's knowledge and session findings appear in your editor context. While you write code, vigilant's analysis is available to Claude.

---

## Third-Party Tool Integration

vigilant reads findings from Snyk, CodeRabbit, Dependabot, and GitHub Advanced Security automatically — no API keys needed. It detects their presence by reading their GitHub review comments.

| Tool | Cost | Required |
|---|---|---|
| Dependabot | Free for all repos | No |
| Snyk | Free for public repos only | No |
| CodeRabbit | Free for public repos only | No |

When no tools are present, vigilant operates in fallback mode and does the full review + self-review itself.

---

## Security and Privacy

vigilant runs entirely on your machine. There is no central vigilant server. Your code never leaves your machine except to reach your chosen AI provider (Gemini, Groq, OpenAI — your choice). Your GitHub token is stored locally with owner-only file permissions and is only ever sent to `api.github.com`.

Each repository's learned knowledge is isolated in its own namespace. A user watching a Stripe repo cannot access knowledge learned from a Juspay repo.

---

## Tech Stack

- TypeScript + Node.js 20
- `@juspay/neurolink` — AI calls, RAG, AutoResearch, MCP tools
- `@octokit/rest` — GitHub API
- `better-sqlite3` — local state and knowledge base
- `@modelcontextprotocol/sdk` — MCP server
- `commander` — CLI
- `inquirer` + `chalk` + `ora` — terminal UI
- Google Gemini Flash (free tier) with Groq as automatic fallback

---

## Architecture

See `docs/architecture.md` for the full system design including the three cross-verification loops, the agentic loop state machine, the self-review loop, the two HITL gates, the knowledge stack, and the MCP server tool definitions.

