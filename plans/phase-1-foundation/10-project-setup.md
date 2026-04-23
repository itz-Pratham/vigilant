# Phase 1 — Project Setup

**Files:** `package.json`, `tsconfig.json`, `src/bin.ts`

## Objective

The scaffolding that makes vigilant an installable, publishable npm package. `npm install -g vigilant` must work. `tsc` must compile cleanly. `vigilant --help` must print usage.

---

## package.json

```json
{
  "name": "vigilant",
  "version": "0.1.0",
  "description": "Autonomous GitHub code guardian — watches repos, finds issues, writes fixes, opens PRs.",
  "keywords": ["cli", "ai", "github", "code-quality", "autonomous-agent"],
  "license": "MIT",
  "bin": {
    "vigilant": "./dist/bin.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist", "knowledge"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build":          "tsc",
    "dev":            "tsx watch src/bin.ts",
    "prepublishOnly": "npm run build",
    "typecheck":      "tsc --noEmit",
    "lint":           "eslint src --ext .ts"
  },
  "dependencies": {
    "@juspay/neurolink":          "latest",
    "@modelcontextprotocol/sdk":  "latest",
    "@octokit/rest":              "^20.0.0",
    "better-sqlite3":             "^9.0.0",
    "chalk":                      "^5.0.0",
    "cli-table3":                 "^0.6.5",
    "commander":                  "^12.0.0",
    "date-fns":                   "^3.0.0",
    "inquirer":                   "^9.0.0",
    "minimatch":                  "^9.0.0",
    "ora":                        "^8.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3":      "^7.6.0",
    "@types/inquirer":            "^9.0.0",
    "@types/minimatch":           "^5.1.0",
    "@types/node":                "^20.0.0",
    "tsx":                        "^4.0.0",
    "typescript":                 "^5.4.0"
  }
}
```

---

## tsconfig.json

```json
{
  "compilerOptions": {
    "target":           "ES2022",
    "module":           "Node16",
    "moduleResolution": "Node16",
    "outDir":           "./dist",
    "rootDir":          "./src",
    "strict":           true,
    "esModuleInterop":  true,
    "skipLibCheck":     true,
    "declaration":      true,
    "declarationMap":   true,
    "sourceMap":        true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

Note: `paths` aliases (`@/`) require `tsconfig-paths` or `tsx` at runtime for dev. In the compiled `dist/`, the paths are resolved by the TypeScript compiler — no runtime path resolution needed.

---

## src/bin.ts

The entry point. Imports the root Commander program and calls `.parseAsync()`. All error handling at the top level.

```typescript
#!/usr/bin/env node
// src/bin.ts

import { program } from './cli';

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\nError: ${message}\n`);
  process.exit(1);
});
```

---

## Directory Structure Created in Phase 1

```
vigilant/
├── knowledge/
│   ├── payments/        ← seed .md files (Phase 8)
│   ├── security/
│   ├── reliability/
│   └── compliance/
├── src/
│   ├── bin.ts           ← entry point
│   ├── cli/
│   │   ├── index.ts     ← root Commander program
│   │   └── commands/
│   │       ├── init.ts, start.ts, status.ts, session.ts,
│   │           approve.ts, learn.ts, serve.ts, config.ts
│   ├── lib/
│   │   ├── constants.ts
│   │   ├── errors.ts
│   │   ├── logger.ts
│   │   └── github.ts
│   ├── config/
│   │   ├── types.ts
│   │   └── index.ts
│   └── db/
│       ├── index.ts
│       ├── migrations/
│       │   ├── state.sql
│       │   └── knowledge.sql
│       └── queries/
│           ├── sessions.ts
│           ├── watcher.ts
│           └── knowledge.ts
├── package.json
├── tsconfig.json
└── AGENT.md
```
