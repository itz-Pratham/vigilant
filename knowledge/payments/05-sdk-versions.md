# Payment SDK Version Management

## Why it matters
Payment SDKs receive security patches, API deprecation fixes, and TLS updates. Running ≥1 minor version behind risks:
- Missing security patches for known CVEs
- Using deprecated API fields that get removed
- Incompatibility with new webhook event schemas from the provider

## How to implement

```typescript
// package.json — pin exact minor, allow patch updates
{
  "dependencies": {
    "stripe": "^14.0.0",      // allows patch updates, locks major.minor
    "razorpay": "^2.9.0"
  }
}
```

```bash
# Check for outdated payment packages
npm outdated stripe razorpay

# Automated: Dependabot config in .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    allow:
      - dependency-name: "stripe"
      - dependency-name: "razorpay"
```

## Key implementation details
- Never use `"stripe": "latest"` in production — unexpected breaking changes
- Run full payment integration tests (test mode) after every SDK upgrade
- Read the SDK changelog BEFORE upgrading major versions — always has breaking changes
- Use GitHub Dependabot or Renovate for automated version bump PRs

## References
- https://github.com/stripe/stripe-node/releases
- https://github.com/razorpay/razorpay-node/releases
- https://docs.github.com/en/code-security/dependabot
