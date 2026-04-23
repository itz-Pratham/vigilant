# Phase 5 — Rate Limiting

**File:** `src/executor/rate-limiting.ts`

## Objective

The executor makes more write API calls than any other phase. Ensure all GitHub API calls are wrapped with the same retry-with-backoff utility used by the watcher, and track the write budget separately from read calls.

---

## Write API Budget

| Call | Per execution | Worst case (20 sessions/hr) |
|---|---|---|
| `git.createRef` | 1 | 20 |
| `repos.getContent` | N files | 100 (5 files avg) |
| `repos.createOrUpdateFileContents` | N files | 100 (5 files avg) |
| `pulls.create` | 1 | 20 |
| `issues.addLabels` | 1 | 20 |
| `actions.listWorkflowRunsForRepo` | ~30 (CI polling) | 600 |
| **Total** | ~35 | ~860 |

GitHub REST: 5000/hr. Even at 20 concurrent sessions, budget is safe (~17% usage).

---

## Retry Wrapper

Reuses `callWithRetry` from Phase 3 (`src/agent/error-handling.ts`):

```typescript
import { callWithRetry } from '../agent/error-handling.js';

// Usage in executor:
await callWithRetry(
  () => octokit.git.createRef({ owner, repo, ref, sha }),
  { maxRetries: 3, baseDelayMs: 1000, retryOn: [500, 502, 503] }
);
```

**429 handling:** GitHub returns `Retry-After` header on rate limit. The retry wrapper reads it:

```typescript
if (err.status === 429 || err.status === 403) {
  const retryAfter = parseInt(err.response?.headers?.['retry-after'] ?? '60', 10);
  await sleep(retryAfter * 1000);
}
```

---

## Sequential vs Concurrent

All executor steps run sequentially within a session. Between sessions, the daemon runs them concurrently. The `gate-queue.ts` (Phase 4) ensures only one Gate 1 prompt at a time, but execution after approval is fully parallel across sessions.

```typescript
// In daemon tick (Phase 5 integration):
const executingSessions = listSessionsByStage(db, 'executing');
await Promise.allSettled(
  executingSessions.map(s => runExecutor(s, octokit, neurolink))
);
```

---

## Large File Handling

GitHub Contents API `GET` returns content as base64. Files >1MB return `download_url` instead of inline `content`. The code writer handles this:

```typescript
if (!data.content && data.download_url) {
  const resp = await fetch(data.download_url);
  originalContent = await resp.text();
} else {
  originalContent = Buffer.from(data.content ?? '', 'base64').toString('utf-8');
}
```

Files >100KB should not be fully regenerated. Instead, only the changed section is sent to NeuroLink (context trimming — documented in Phase 8 domain packs).
