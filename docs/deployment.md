# vigilant — Deployment Guide

---

## Publishing to npm

### Prerequisites

- npm account at npmjs.com
- Package name `vigilant` or `@yourscope/vigilant` available
- TypeScript compiled cleanly: `npm run build` passes

### package.json setup

```json
{
  "name": "vigilant",
  "version": "0.1.0",
  "description": "Autonomous code intelligence daemon — watches your repo, finds issues, fixes them.",
  "bin": {
    "vigilant": "./dist/cli/index.js"
  },
  "main": "./dist/index.js",
  "files": ["dist", "knowledge", "README.md"],
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  },
  "engines": {
    "node": ">=20"
  }
}
```

### Publishing steps

```bash
npm login
npm run build
npm publish --access public   # if scoped: npm publish --access public
```

### Version bumping

```bash
npm version patch   # bug fixes
npm version minor   # new features
npm version major   # breaking changes
npm publish
```

---

## User Installation

```bash
npm install -g vigilant
vigilant --version   # verify
vigilant init        # first-time setup wizard
```

---

## Always-On with pm2

For users who want vigilant running permanently in the background:

```bash
npm install -g pm2
pm2 start vigilant -- start --repo org/repo
pm2 save
pm2 startup   # follow the printed instruction to make pm2 survive reboots
```

Useful pm2 commands:
```bash
pm2 list          # show all processes
pm2 logs vigilant # tail logs
pm2 stop vigilant
pm2 restart vigilant
pm2 delete vigilant
```

---

## MCP Integration

### Cursor

Add to `~/.cursor/mcp.json`:
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

Restart Cursor. The vigilant tools appear in Claude's context automatically.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):
```json
{
  "mcpServers": {
    "vigilant": {
      "command": "vigilant",
      "args": ["serve", "--port", "3001"]
    }
  }
}
```

---

## Optional Tool Integration

vigilant works without any third-party tools. If they are present, vigilant reads their output and synthesises it with team context. They do not need to be installed or configured inside vigilant — it detects them automatically by reading PR review comments.

### Tool Availability

| Tool | Cost | Where to enable |
|---|---|---|
| Dependabot | Free for all repos | GitHub repo → Settings → Security → Dependabot alerts |
| Snyk | Free for **public** repos only; $25/dev/month for private | snyk.io → connect GitHub org |
| CodeRabbit | Free for **public** repos only; $19/dev/month for private | coderabbit.ai → install GitHub App |
| GitHub Advanced Security | Free for public repos; paid for private | GitHub repo → Settings → Code security and analysis |

When these tools are not present on a PR, vigilant automatically operates in fallback mode — it does the review itself and self-reviews its own PRs before Gate 1.

### Fallback Mode (Default for Private Repos)

```bash
# No configuration needed — vigilant detects tool absence automatically
vigilant start --repo org/repo
```

When tool bots are absent from PR review threads, vigilant:
1. Performs its own investigation (same quality, informed by knowledge base)
2. Opens its fix PR
3. Self-reviews the PR (max 3 iterations) using NeuroLink + domain knowledge
4. Presents Gate 1 with the self-verified PR

---

## Environment Requirements

No cloud infrastructure required. No database server. No message broker. Only:

- Node.js 20+ on the user's machine
- A GitHub personal access token (free)
- A Gemini API key (free at aistudio.google.com) or Groq key (free at console.groq.com)
