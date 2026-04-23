# N+1 Query Prevention

## Why it matters
An N+1 query occurs when fetching N entities requires N additional queries (one per entity). For N=1000 orders, this means 1001 database roundtrips instead of 2. Each query adds 1–5ms latency, turning a 10ms endpoint into a 1-5s disaster.

## How to implement

```typescript
// WRONG — N+1 pattern
const orders = await prisma.order.findMany({ where: { status: 'pending' } });
for (const order of orders) {
  const customer = await prisma.customer.findUnique({ where: { id: order.customerId } });
  // 1 query per order → N+1 total
}

// CORRECT — eager loading with Prisma include
const orders = await prisma.order.findMany({
  where: { status: 'pending' },
  include: { customer: true },  // 2 queries total regardless of N
});

// CORRECT — DataLoader for custom aggregation
import DataLoader from 'dataloader';
const customerLoader = new DataLoader(async (ids: readonly string[]) => {
  const customers = await prisma.customer.findMany({ where: { id: { in: [...ids] } } });
  const map = new Map(customers.map(c => [c.id, c]));
  return ids.map(id => map.get(id) ?? null);
});

// Usage — all calls within same tick are batched into one query
const customer = await customerLoader.load(order.customerId);

// TypeORM
const orders = await orderRepo.find({
  where: { status: 'pending' },
  relations: ['customer'],  // eager join
});
```

## References
- https://www.prisma.io/docs/guides/performance-and-optimization/query-optimization-performance
- https://github.com/graphql/dataloader
