# Phase 5 — Commit Messages

**File:** Conventions for all Git commits made by vigilant.

## Objective

Every commit message vigilant creates must follow Conventional Commits format, be traceable to its session, and include the domain and issue type for easy `git log` filtering.

---

## Commit Message Format

```
{type}({scope}): {description} [vigilant]

Session: {sessionId}
Domain:  {domain}
Issue:   {issueType}
```

**Limits:** First line ≤ 72 characters. Body lines ≤ 80 characters.

---

## Type and Scope Rules

| Change | `type` | `scope` |
|---|---|---|
| Code fix | `fix` | issue type in lowercase snake_case |
| New utility added | `feat` | issue type or module name |
| Config change | `chore` | `config` |
| Security fix | `fix` | `security` |

---

## Examples

```
fix(missing_idempotency): add idempotency key to createPayment [vigilant]

Session: SESS_vigilant_MISSING_IDEMPOTENCY_acme_api_001
Domain:  payments
Issue:   MISSING_IDEMPOTENCY
```

```
fix(webhook_no_signature): verify HMAC-SHA256 on POST /webhook [vigilant]

Session: SESS_vigilant_WEBHOOK_NO_SIGNATURE_stripe_backend_003
Domain:  payments
Issue:   WEBHOOK_NO_SIGNATURE
```

```
fix(secret_in_code): remove hardcoded API key, load from env [vigilant]

Session: SESS_vigilant_SECRET_IN_CODE_myapp_server_002
Domain:  security
Issue:   SECRET_IN_CODE
```

---

## Implementation

In `code-writer.ts`, the commit message is built before each file write:

```typescript
function buildCommitMessage(session: IssueSession, change: FileChange): string {
  const typeStr  = session.severity === 'CRITICAL' ? 'fix' : 'fix';
  const scope    = session.issueType.toLowerCase();
  const desc     = change.description.slice(0, 50);  // trim to keep first line ≤72

  const headline = `${typeStr}(${scope}): ${desc} [vigilant]`;

  const body = [
    '',
    `Session: ${session.sessionId}`,
    `Domain:  ${session.domain}`,
    `Issue:   ${session.issueType}`,
  ].join('\n');

  return headline + body;
}
```

---

## Multi-File Sessions

When a session touches multiple files, each file gets its own commit with the same session ID in the body. This makes `git log --grep="SESS_vigilant_"` show every file touched by a session in one view.
