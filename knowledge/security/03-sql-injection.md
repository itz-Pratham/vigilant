# SQL Injection Prevention

## Why it matters
SQL injection allows attackers to read, modify, or delete any data in your database by inserting SQL syntax into user-supplied inputs. It is the #1 most exploited web vulnerability (OWASP Top 10).

## How to implement

```typescript
// WRONG — string interpolation creates injection risk
const query = `SELECT * FROM users WHERE email = '${email}'`;

// CORRECT — parameterized queries (pg)
const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);

// CORRECT — ORM (Prisma, always safe)
const user = await prisma.user.findUnique({ where: { email } });

// CORRECT — ORM (TypeORM, use parameters not interpolation)
const user = await userRepo.findOne({ where: { email } });

// WRONG with TypeORM — still injectable
const user = await userRepo.query(`SELECT * FROM users WHERE email = '${email}'`);

// CORRECT with TypeORM raw query
const user = await userRepo.query('SELECT * FROM users WHERE email = $1', [email]);
```

## Key implementation details
- If using an ORM, never use its raw query method with string interpolation — it defeats the ORM's protection
- Stored procedures are not safe by default — they can also contain injection if they build dynamic SQL
- Input validation is NOT a substitute for parameterized queries — validate AND parameterize
- Test with `'; DROP TABLE users; --` and `' OR '1'='1` in CI

## References
- https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
- https://www.postgresql.org/docs/current/sql-prepare.html
