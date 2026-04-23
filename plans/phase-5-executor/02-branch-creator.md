# Phase 5 — Branch Creator

**File:** `src/executor/branch-creator.ts`

## Objective

Create a new GitHub branch from the tip of the repo's default branch. Must resolve the default branch name dynamically (not hard-code `main`).

---

## Implementation

```typescript
// src/executor/branch-creator.ts
import { Octokit } from '@octokit/rest';
import { ExecutorContext } from './types.js';

/** Resolves the default branch name and its HEAD SHA. */
export async function resolveBaseSha(
  octokit: Octokit,
  owner:   string,
  repo:    string,
): Promise<{ defaultBranch: string; sha: string }> {
  const { data: repoData } = await octokit.repos.get({ owner, repo });
  const defaultBranch = repoData.default_branch; // 'main', 'master', etc.

  const { data: refData } = await octokit.git.getRef({
    owner, repo,
    ref: `heads/${defaultBranch}`,
  });

  return { defaultBranch, sha: refData.object.sha };
}

/**
 * Creates a branch on GitHub.
 * Returns the branch name on success.
 * Throws `ExecutorError` with step = 'branch_created' on GitHub API failure.
 */
export async function createBranch(
  octokit: Octokit,
  ctx:     ExecutorContext,
): Promise<string> {
  await octokit.git.createRef({
    owner: ctx.owner,
    repo:  ctx.repo,
    ref:   `refs/heads/${ctx.branchName}`,
    sha:   ctx.baseSha,
  });

  return ctx.branchName;
}
```

---

## Branch Name Format

```
vigilant/fix/{issueType-kebab}-{shortSha}
```

Where `shortSha` = first 7 chars of `baseSha`. Generated in Phase 3 (`buildSessionId.ts`) and stored in `plan.branchName`.

**Examples:**
```
vigilant/fix/missing-idempotency-a1b2c3d
vigilant/fix/webhook-no-signature-f4e5d6c
vigilant/fix/secret-in-code-9a8b7c6
```

---

## Error Handling

| Scenario | Action |
|---|---|
| `422 Reference already exists` | Branch exists from a previous crashed run — skip creation, continue |
| `403 Resource not accessible` | No push access — mark session `blocked`: "No push access to repository" |
| `404 Repository not found` | Mark `blocked`: "Repository not found or access revoked" |
| Network timeout | Retry up to 3× with exponential backoff, then mark `blocked` |

```typescript
try {
  await createBranch(octokit, ctx);
} catch (err: any) {
  if (err.status === 422) {
    // Branch already exists — treat as success (restart recovery)
    return ctx.branchName;
  }
  throw new ExecutorError(`Branch creation failed: ${err.message}`, 'branch_created');
}
```
