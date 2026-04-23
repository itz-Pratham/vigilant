# JWT Middleware and Route Authentication

## Why it matters
Unauthenticated routes expose internal operations, admin functions, and user data to any actor on the internet. A single unprotected route can compromise an entire system.

## How to implement

```typescript
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

type AuthenticatedRequest = Request & { user: { id: string; role: string } };

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { id: string; role: string };
    (req as AuthenticatedRequest).user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(role: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthenticatedRequest).user;
    if (user.role !== role) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

// Usage
router.post('/admin/action', requireAuth, requireRole('admin'), handler);
```

## Key implementation details
- Apply `requireAuth` at the router level, not per-route, to avoid missing it on new routes
- JWT secret must be at least 256 bits (32 chars of random) — never a short or guessable string
- Set `expiresIn` on tokens — never issue non-expiring tokens
- Use `RS256` (asymmetric) for distributed systems where multiple services verify tokens

## References
- https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html
- https://jwt.io/introduction
