# Input Validation at System Boundaries

## Why it matters
User inputs that reach business logic, database queries, or external API calls without validation are the root cause of injection attacks, crashes, and corrupted state. Validate at the boundary — the moment data enters the system.

## How to implement

```typescript
import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

const CreatePaymentSchema = z.object({
  amount:       z.number().int().positive().max(1_000_000),  // cents
  currency:     z.enum(['USD', 'EUR', 'GBP', 'INR']),
  customerId:   z.string().regex(/^cus_[a-zA-Z0-9]+$/),
  description:  z.string().max(500).optional(),
});

type CreatePaymentBody = z.infer<typeof CreatePaymentSchema>;

function validateBody<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Invalid request', issues: result.error.issues });
      return;
    }
    req.body = result.data;  // replace with parsed/coerced data
    next();
  };
}

router.post('/payments', validateBody(CreatePaymentSchema), async (req, res) => {
  const body = req.body as CreatePaymentBody;
  // body is fully type-safe here
});
```

## Key implementation details
- Validate at the HTTP boundary (middleware), not inside business logic
- Use `safeParse` not `parse` — never throw validation errors from middleware without catching
- Coerce types explicitly (Zod does this automatically with `.coerce`) — never trust `req.body` types
- Reject requests with extra fields using `z.object().strict()` if appropriate

## References
- https://zod.dev
- https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
