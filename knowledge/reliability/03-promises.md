# Handling Floating Promises

## Why it matters
A "floating" promise is one that is not awaited, not `.catch()`-ed, and not assigned to a variable with later handling. When it rejects, Node.js emits an `unhandledRejection` event. In Node 15+, this terminates the process. In earlier versions, it is silently ignored — hiding errors.

## How to implement

```typescript
// WRONG — floating promises in all common patterns

// 1. Forgotten await
async function processOrder(orderId: string) {
  updateOrderStatus(orderId, 'processing');  // floating — if this rejects, silent
  await chargeCustomer(orderId);
}

// 2. forEach with async callback
orderIds.forEach(async (id) => {
  await processOrder(id);  // each iteration is floating
});

// CORRECT alternatives

// 1. Add await
async function processOrder(orderId: string) {
  await updateOrderStatus(orderId, 'processing');
  await chargeCustomer(orderId);
}

// 2. void operator when fire-and-forget is intentional
void sendAnalyticsEvent({ event: 'page_view' });  // explicit: we know it's not awaited

// 3. Promise.all for parallel operations
await Promise.all(orderIds.map(id => processOrder(id)));

// Global handler for missed cases
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', { reason, promise });
  process.exit(1);  // fail fast — do not hide the error
});
```

## References
- https://nodejs.org/api/process.html#event-unhandledrejection
- https://typescript-eslint.io/rules/no-floating-promises/
