# Webhook Signature Verification

## Why it matters
Webhooks are unauthenticated HTTP callbacks — any actor can POST to your webhook URL. Without signature verification, attackers can send fake payment success events, triggering order fulfilment without actual payment.

## How to implement

```typescript
// Stripe
import express from 'express';
const router = express.Router();

router.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    logger.warn('Webhook signature verification failed', { err });
    return res.status(400).send('Signature verification failed');
  }
  // Now safe to process event
  handleEvent(event);
  res.json({ received: true });
});

// Razorpay
import crypto from 'crypto';
function verifyRazorpaySignature(body: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

## Key implementation details
- Always use `express.raw()` before the webhook route — parsed JSON body breaks HMAC verification
- Verify the signature BEFORE any business logic — return 400 immediately on failure
- Use `crypto.timingSafeEqual()` for comparison — prevents timing attacks
- Log signature mismatches for security monitoring — never silently ignore
- Rotate webhook secrets quarterly; support two active secrets during rotation

## References
- https://stripe.com/docs/webhooks/signatures
- https://razorpay.com/docs/webhooks/validate-test/
