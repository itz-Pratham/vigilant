# vigilant — Security Model

---

## Design Principle

vigilant has no central server. Every user runs their own isolated process. This makes the security model simple: the only trust boundaries are between the user's machine, GitHub's API, and the AI provider.

---

## Data Classification

| Data | Where stored | Who can read it |
|---|---|---|
| GitHub token | `~/.vigilant/config.json` (mode 0o600) | Owner process only |
| AI API keys | `~/.vigilant/config.json` (mode 0o600) | Owner process only |
| Session state (code findings, plans) | `~/.vigilant/state.db` | Owner process only |
| Knowledge base (learned patterns) | `~/.vigilant/knowledge.db` | Owner process only |
| Code content read for analysis | In-memory only during session, never written to disk | Not persisted |
| PR review comments from external tools | In-memory only during synthesis, not written to disk | Not persisted |

---

## Multi-Repo Isolation

When a user watches multiple repos, isolation is enforced at two independent layers.

**Layer 1 — GitHub token.** The token grants access only to repos the user has permission to read. vigilant cannot read a repo the token cannot access. This is enforced by GitHub, not by vigilant code.

**Layer 2 — RAG scope filter.** Every query to the knowledge base includes a mandatory scope clause:

```typescript
// Inside src/rag/index.ts — this function signature enforces scope
export async function searchKnowledge(
  query: string,
  scope: KnowledgeScope,   // required, not optional
  domain: string
): Promise<KnowledgeDocument[]> {
  return db.all(
    `SELECT * FROM knowledge_documents
     WHERE scope IN ('global', ?)
     AND domain = ?
     ORDER BY created_at DESC`,
    [scope, domain]
  );
}
```

The `scope` parameter is always constructed from the current session's `repo_owner` and `repo_name`. There is no code path that queries without a scope.

---

## Config File Security

```typescript
// src/config/index.ts
await fs.writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
```

On every write, permissions are explicitly set. If the file already exists with wrong permissions (e.g., 0o644), it is corrected before writing.

---

## What Leaves the Machine

| Data | Destination | When |
|---|---|---|
| GitHub token | `api.github.com` only | Every GitHub API call |
| Code snippets (relevant to the issue) | AI provider (Gemini/Groq) | During agentic loop investigation |
| Search queries | AI provider | During learning mode |
| Nothing | Any vigilant server | Never — no vigilant server exists |

Users who are concerned about sending code to an AI provider can use Ollama (local model, no external calls) by configuring `provider: "ollama"` in the config.

---

## Secrets Never Logged

The logger in `src/lib/logger.ts` strips known secret patterns before writing any log line. The following are never logged under any circumstances:

- `githubToken`
- `geminiApiKey`, `groqApiKey`, `openaiApiKey`
- Any string matching a GitHub PAT pattern (`ghp_`, `github_pat_`)
- Any string matching an API key pattern (40+ alphanumeric characters)

---

## MCP Server Security

When running `vigilant serve`, the MCP server listens on localhost only by default. It does not bind to `0.0.0.0` unless explicitly configured with `--host 0.0.0.0`. All MCP tool responses are scoped to the caller's configured repos — the server reads from the local SQLite which is already scoped.

---

## Tool Observer Security

The Tool Observer reads PR review comments from other bot accounts (Snyk, CodeRabbit, Dependabot, GitHub Advanced Security). This introduces one new trust consideration:

**Comment content is treated as untrusted input.** A malicious actor who can post a PR comment cannot influence vigilant's fix logic through that comment — tool findings are used as supplementary context in the RAG query, not as instructions to the agent. The agent's instructions come only from domain packs and the knowledge base.

**Read-only access.** The Tool Observer only calls `GET /repos/{owner}/{repo}/issues/{pr_number}/comments`. It never posts comments on behalf of external tools.

**No third-party account credentials.** vigilant never needs a Snyk API key, CodeRabbit API key, or Dependabot token. It reads their output from the GitHub API using the user's own GitHub token.

---

## Self-Review Loop Security

When vigilant self-reviews its own PRs (fallback mode), the review uses:
1. NeuroLink generate() — same AI provider as the investigation, same trust level
2. Domain knowledge from knowledge.db — user's own knowledge base, already trusted

The self-review loop cannot introduce new data sources or bypass the RAG scope filter. It is subject to the same security constraints as the main agent loop.
