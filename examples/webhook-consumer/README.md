# Webhook Consumer Example

This example demonstrates how to build a production-grade webhook receiver for Stellar Intel in Node.js with zero dependencies (`node:crypto` and `node:http`).

It shows how to:
1. Verify the `x-webhook-signature` header (`t={timestamp},v1={hmac}`) using constant-time comparison (`timingSafeEqual`).
2. Reject stale signatures older than the tolerance window (default 300s) to prevent replay attacks.
3. De-duplicate delivery attempts using `x-webhook-idempotency-key` via a bounded in-memory eviction set.

## Running Locally

```bash
WEBHOOK_SECRET=your_signing_secret node examples/webhook-consumer/server.mjs
```

By default, the server listens on port `8787` (configurable via `PORT=8787`).

## Exposing over HTTPS

Stellar Intel webhook delivery requires a public HTTPS URL. You can expose your local server using a tunneling tool (such as ngrok or Cloudflare Tunnel):

```bash
ngrok http 8787
```

Use the generated public HTTPS URL (e.g. `https://your-tunnel.ngrok-free.app/webhook`) when registering a webhook subscription.

## Creating a Webhook Subscription

Register your HTTPS webhook endpoint using `POST /api/webhooks/subscriptions` with your administrative API key:

```bash
curl -X POST https://stellar-intel.vercel.app/api/webhooks/subscriptions \
  -H "x-admin-key: $ADMIN_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-tunnel.ngrok-free.app/webhook",
    "secret": "your_signing_secret",
    "events": ["*"]
  }'
```
