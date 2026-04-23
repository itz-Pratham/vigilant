# Environment Variables vs Hardcoded Secrets

## Why it matters
Hardcoded API keys in source code get committed to git history and exposed to anyone with repo access. Even after deletion, git history retains the secret permanently unless the entire branch history is rewritten.

## How to implement

```typescript
// WRONG — never do this
const stripe = new Stripe('sk_live_abc123xyz');

// CORRECT — always use environment variables
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// CORRECT with validation at startup
function loadConfig(): { stripeKey: string; dbUrl: string } {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const dbUrl = process.env.DATABASE_URL;
  if (!stripeKey) throw new Error('STRIPE_SECRET_KEY is required');
  if (!dbUrl) throw new Error('DATABASE_URL is required');
  return { stripeKey, dbUrl };
}
```

## Key implementation details
- Add `.env` to `.gitignore` — commit `.env.example` with placeholder values instead
- Use `dotenv` for local development, never in production (use platform env vars)
- Enable GitHub secret scanning for the repo (catches accidental commits)
- Rotate any secret that was ever committed to git — assume it is compromised
- Use `process.env.VAR!` only after validating at startup — fail fast if missing

## References
- https://docs.github.com/en/code-security/secret-scanning
- https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
