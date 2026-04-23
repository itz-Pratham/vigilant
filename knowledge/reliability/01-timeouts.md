# Timeout Configuration for Outbound HTTP Calls

## Why it matters
An outbound HTTP call with no timeout can hang indefinitely, blocking the event loop thread pool, exhausting connection pools, and causing cascading failures across your entire service. One slow downstream service becomes your entire service's outage.

## How to implement

```typescript
import axios from 'axios';

// axios — set timeout on every client, not per-request
const httpClient = axios.create({
  timeout: 5000,  // 5 seconds — adjust per SLA
  baseURL: 'https://api.payment-provider.com',
});

// fetch with AbortController
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// node-fetch timeout (older codebases)
await fetch(url, { timeout: 5000 });
```

## Timeout reference by call type

| Call type | Recommended timeout |
|---|---|
| Internal microservice | 500ms–1s |
| Payment API (Stripe, Razorpay) | 10s–30s |
| Third-party webhook delivery | 5s |
| Database query (OLTP) | 2s–5s |
| External search/analytics | 10s–30s |

## References
- https://axios-http.com/docs/req_config
- https://developer.mozilla.org/en-US/docs/Web/API/AbortController
