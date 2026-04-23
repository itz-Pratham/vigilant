# Phase 5 — Code Writer

**File:** `src/executor/code-writer.ts`

## Objective

For each `FileChange` in the approved plan, read the current file content from GitHub, use NeuroLink to apply the fix, then write the result back — all via the GitHub Contents API. Must handle binary files, missing files, and partial-write failures.

---

## Implementation

```typescript
// src/executor/code-writer.ts
import { Octokit }   from '@octokit/rest';
import { NeuroLink } from '@juspay/neurolink';
import { IssueSession, FileChange } from '../types.js';
import { ExecutorContext, FileWriteResult } from './types.js';
import { ExecutorError } from '../errors.js';

const FIX_PROMPT = (
  path:      string,
  issue:     string,
  change:    string,
  original:  string,
) => `You are applying a targeted code fix.

File: ${path}
Issue: ${issue}
Required change: ${change}

Original file content:
\`\`\`
${original}
\`\`\`

Return ONLY the complete updated file content. No explanation. No markdown fences. No commentary.
`;

/**
 * Reads file from GitHub, generates fix with NeuroLink, writes back.
 * Returns FileWriteResult — success or failure with error message.
 */
export async function writeFileChange(
  octokit:     Octokit,
  neurolink:   NeuroLink,
  session:     IssueSession,
  ctx:         ExecutorContext,
  change:      FileChange,
): Promise<FileWriteResult> {
  // 1. Read current content + file SHA (needed for PUT)
  let originalContent: string;
  let fileSha: string;

  try {
    const { data } = await octokit.repos.getContent({
      owner: ctx.owner,
      repo:  ctx.repo,
      path:  change.path,
      ref:   ctx.branchName,
    });

    if (Array.isArray(data) || data.type !== 'file') {
      return { path: change.path, commitSha: '', success: false, error: 'Path is a directory, not a file' };
    }

    originalContent = Buffer.from(data.content ?? '', 'base64').toString('utf-8');
    fileSha = data.sha;
  } catch (err: any) {
    if (err.status === 404) {
      // New file — no existing SHA needed
      originalContent = '';
      fileSha = '';
    } else {
      return { path: change.path, commitSha: '', success: false, error: `Read failed: ${err.message}` };
    }
  }

  // 2. Generate fixed content via NeuroLink
  const { text: newContent } = await neurolink.generate({
    prompt:   FIX_PROMPT(change.path, session.issueType, change.description, originalContent),
    provider: 'google',
    model:    'gemini-2.0-flash',
  });

  // 3. Write back to GitHub
  const commitMessage = `fix(${session.domain}): ${change.description} [vigilant]`;
  const encodedContent = Buffer.from(newContent).toString('base64');

  const params: any = {
    owner:   ctx.owner,
    repo:    ctx.repo,
    path:    change.path,
    message: commitMessage,
    content: encodedContent,
    branch:  ctx.branchName,
  };
  if (fileSha) params.sha = fileSha; // required for updates; omit for new files

  try {
    const { data: commitData } = await octokit.repos.createOrUpdateFileContents(params);
    return {
      path:      change.path,
      commitSha: commitData.commit.sha ?? '',
      success:   true,
    };
  } catch (err: any) {
    return { path: change.path, commitSha: '', success: false, error: `Write failed: ${err.message}` };
  }
}

/**
 * Processes all file changes. Returns array of results.
 * Caller (orchestrator) handles any failures.
 */
export async function writeAllChanges(
  octokit:   Octokit,
  neurolink: NeuroLink,
  session:   IssueSession,
  ctx:       ExecutorContext,
): Promise<FileWriteResult[]> {
  const results: FileWriteResult[] = [];

  for (const change of session.plan!.changes) {
    const result = await writeFileChange(octokit, neurolink, session, ctx, change);
    results.push(result);
    // Sequential writes — concurrent writes on the same branch cause SHA conflicts
  }

  return results;
}
```

---

## Sequential vs Parallel

Writes **must** be sequential. GitHub's Contents API requires the SHA of the last commit to write a file. Parallel writes to the same branch cause `409 Conflict` from stale SHAs.

---

## Token Budget

NeuroLink truncates at model context limits. For files >50KB, only send the relevant section:
```typescript
// Trim originalContent to ±200 lines around each change marker (Phase 8 detail)
const trimmedContent = trimAroundChange(originalContent, change);
```

Full trimming implementation is documented in `08-domain-packs` — each domain knows what context matters.
