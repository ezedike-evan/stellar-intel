# Webhooks

**Last reviewed:** 2026-11-22

Stellar Intel can push real-time event notifications to your HTTPS endpoint instead of requiring you to poll the API. Each delivery is HMAC-SHA256 signed so you can verify authenticity before acting on the payload.

A reference receiver demonstrating signature verification, idempotency handling, and mock event ingestion is available at [`examples/webhook-consumer/`](../examples/webhook-consumer/).

## Event types

Stellar Intel supports 14 webhook event kinds across the lifecycle of intents, settlements, reputation data, anchor health, disputes, refunds, and oracle operations:

| Kind | Producing Route / Trigger | Status |
| --- | --- | --- |
| `intent.created` | `POST /api/intent/offramp`, `POST /api/v1/intent/offramp`, `POST /api/v1/intent/onramp` returns 200/201 | Live |
| `intent.settled` | `POST /api/reputation/append` returns 200 (terminal `completed`) | Live |
| `intent.failed` | `POST /api/reputation/append` returns 200 (terminal `error`, `expired`, `refunded`) | Live |
| `reputation.event_written` | `POST /api/reputation/append` returns 200 (new outcome row written) | Live |
| `anchor.health_status_changed` | Publisher cycle detects an anchor degraded status transition | Live |
| `intent.rejected` | `POST /api/intent/offramp`, `POST /api/v1/intent/offramp` returns 400, 401, 409 | Live |
| `intent.expired` | `POST /api/intent/offramp`, `POST /api/v1/intent/offramp` returns 410 (deadline passed) | Live |
| `settlement.status_changed` | `POST /api/intent/status` returns 200 (anchor status transition observed) | Live |
| `dispute.opened` | `POST /api/reputation/dispute` returns 201 | Live |
| `dispute.resolved` | `POST /api/admin/disputes` returns 200 | Live |
| `oracle.published` | Publisher tick writes batch of outcomes and rates on-chain | Live |
| `refund.opened` | Refund case opened for failed or refunded outcome | Subscribable; producer pending |
| `refund.acknowledged` | User signs acknowledgment of refund | Subscribable; producer pending |
| `intent.slippage_breach` | Realized rate breaches quoted minimum floor | Subscribable; producer pending |

---

### intent.created

Fires when an off-ramp or on-ramp intent is created and routed:

```json
{
  "intentHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "direction": "offramp",
  "corridorId": "usdc-ngn",
  "anchorId": "cowrie",
  "quoteId": "quote-123",
  "amount": "100",
  "sourceAsset": "USDC",
  "destinationAsset": "NGN"
}
```

### intent.settled

Fires when an intent reaches a terminal `completed` state:

```json
{
  "intentHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "anchorId": "cowrie",
  "corridor": "usdc-ngn",
  "quotedAmount": "100",
  "stellarTransactionId": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

### intent.failed

Fires when an intent reaches a terminal failed status (`error`, `expired`, `refunded`):

```json
{
  "intentHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "anchorId": "cowrie",
  "corridor": "usdc-ngn",
  "outcome": "error"
}
```

### reputation.event_written

Fires when a new outcome row is recorded in the reputation store:

```json
{
  "intentHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "anchorId": "cowrie",
  "corridor": "usdc-ngn",
  "outcome": "completed",
  "createdAt": "2026-11-20T10:00:00.000Z"
}
```

### anchor.health_status_changed

Fires when an anchor transitions between `healthy` and `degraded`:

```json
{
  "anchorId": "cowrie",
  "from": "healthy",
  "to": "degraded",
  "lastCheckedAt": "2026-11-20T10:00:00.000Z",
  "lastError": "stellar.toml returned HTTP 503"
}
```

### intent.rejected

Fires when an intent request is refused before routing due to signature, replay, or corridor issues:

```json
{
  "intentHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "direction": "offramp",
  "reason": "invalid_signature",
  "sourceAsset": "USDC",
  "destinationAsset": "NGN",
  "amount": "100"
}
```

### intent.expired

Fires when an intent arrives after its deadline:

```json
{
  "intentHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "direction": "offramp",
  "deadline": "2026-11-20T10:00:00.000Z",
  "sourceAsset": "USDC",
  "destinationAsset": "NGN",
  "amount": "100"
}
```

### settlement.status_changed

Fires when a server-side observation records a transaction status transition:

```json
{
  "anchorId": "cowrie",
  "transactionId": "tx-12345",
  "protocol": "sep24",
  "direction": "withdraw",
  "from": "pending_anchor",
  "to": "completed",
  "terminal": true,
  "intentHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "observedAt": "2026-11-20T10:00:00.000Z"
}
```

### dispute.opened

Fires when a user submits a dispute against an outcome:

```json
{
  "disputeId": "disp-123",
  "intentHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "anchorId": "cowrie",
  "createdAt": "2026-11-20T10:00:00.000Z"
}
```

### dispute.resolved

Fires when a dispute is resolved by an operator:

```json
{
  "disputeId": "disp-123",
  "intentHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "anchorId": "cowrie",
  "status": "accepted",
  "resolvedAt": "2026-11-20T10:00:00.000Z"
}
```

### oracle.published

Fires when an oracle publisher batch completes:

```json
{
  "network": "testnet",
  "contractId": "CCORRIDOR123",
  "txHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "outcomesPublished": 5,
  "corridorRatesPublished": 2,
  "corridorMetricsPublished": 2,
  "probeSignalsPublished": 1,
  "publishedAt": "2026-11-20T10:00:00.000Z"
}
```

### refund.opened

Fires when a refund case is opened for an outcome:

```json
{
  "caseId": "ref-123",
  "intentHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "anchorId": "cowrie",
  "corridor": "usdc-ngn",
  "direction": "offramp",
  "reason": "paid_then_failed",
  "status": "opened",
  "openedAt": "2026-11-20T10:00:00.000Z"
}
```

### refund.acknowledged

Fires when a refund recipient acknowledges confirmation:

```json
{
  "caseId": "ref-123",
  "intentHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "anchorId": "cowrie",
  "acknowledgedAt": "2026-11-20T10:00:00.000Z"
}
```

### intent.slippage_breach

Fires when a delivered outcome breaches the quoted slippage floor:

```json
{
  "intentHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "anchorId": "cowrie",
  "corridor": "usdc-ngn",
  "minReceive": "99.5",
  "amountOut": "95.0",
  "shortfall": "4.5",
  "shortfallBps": 450,
  "evidenceHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "status": "detected",
  "detectedAt": "2026-11-20T10:00:00.000Z"
}
```

---

## Payload envelope and idempotency

Every delivery is a `POST` request with `Content-Type: application/json` and a standard envelope:

```json
{
  "id": "3f2a1b4c-9f8e-4a6d-b2a1-0e1f2a3b4c5d",
  "idempotencyKey": "intent.created:0123456789abcdef...",
  "kind": "intent.created",
  "createdAt": "2026-11-22T12:00:00.000Z",
  "payload": { ... }
}
```

### De-duplication

Consumers should de-duplicate on `idempotencyKey`, not `id`. The `id` identifies a specific delivery attempt, while `idempotencyKey` identifies the logical event:

| Event Kind | Idempotency Key Format |
| --- | --- |
| `intent.created` (off-ramp) | `intent.created:${intentHash}` |
| `intent.created` (on-ramp) | `intent.created:onramp:${intentHash}` |
| `intent.settled` | `intent.settled:${intentHash}` |
| `intent.failed` | `intent.failed:${intentHash}` |
| `reputation.event_written` | `reputation.event_written:${intentHash}` |
| `anchor.health_status_changed` | `anchor.health_status_changed:${anchorId}:${to}:${lastCheckedAt}` |
| `intent.rejected` | `intent.rejected:${reason}:${intentHash}` |
| `intent.expired` | `intent.expired:${intentHash}` |
| `settlement.status_changed` | `settlement.status_changed:${anchorId}:${transactionId}:${to}` |
| `dispute.opened` | `dispute.opened:${disputeId}` |
| `dispute.resolved` | `dispute.resolved:${disputeId}:${status}` |
| `oracle.published` | `oracle.published:${network}:${contractId}:${txHash ?? 'none'}` |
| `refund.opened` | `refund.opened:${caseId}` |
| `refund.acknowledged` | `refund.acknowledged:${caseId}` |
| `intent.slippage_breach` | `intent.slippage_breach:${intentHash}:${status}` |

## Signature verification and headers

Each delivery includes four standard headers:

| Header | Value |
| --- | --- |
| `x-webhook-signature` | `t={unix_timestamp_sec},v1={hex_hmac}` |
| `x-webhook-timestamp` | Unix timestamp in seconds (same value as `t` in signature header) |
| `x-webhook-id` | Unique UUID of the delivery attempt |
| `x-webhook-idempotency-key` | Deterministic event idempotency key for de-duplication |

### How to verify

1. Extract `t` (timestamp) and `v1` (signature) from `x-webhook-signature`.
2. Build the signed payload string: concatenate `t`, a literal `.`, and the raw request body bytes exactly as received.
3. Compute `HMAC-SHA256(your_secret, signed_payload)` and encode as lowercase hex.
4. Compare your computed value to `v1` using constant-time comparison to prevent timing attacks.
5. Reject the request if the timestamp is more than 5 minutes old (replay protection).

```ts
import { createHmac, timingSafeEqual } from 'crypto';

function verify(secret: string, header: string, rawBody: string): boolean {
  const parts: Record<string, string> = {};
  for (const seg of header.split(',')) {
    const eq = seg.indexOf('=');
    if (eq !== -1) parts[seg.slice(0, eq)] = seg.slice(eq + 1);
  }

  const { t, v1 } = parts as { t?: string; v1?: string };
  if (!t || !v1) return false;

  const timestamp = parseInt(t, 10);
  if (Number.isNaN(timestamp)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
```

## Delivery log and redelivery

Operators can inspect delivery history and manually re-send events:

### List deliveries

```http
GET /api/webhooks/deliveries?status=dead_letter&limit=50
x-admin-key: <admin_key>
```

Supported query filters:
- `status`: `'success' | 'failed' | 'dead_letter'`
- `subscriptionId`: string filter
- `eventId`: string filter
- `limit`: number between 1 and 500 (default: 100)

### Redeliver a delivery

```http
POST /api/webhooks/deliveries/{id}/redeliver
x-admin-key: <admin_key>
```

Status codes:
- `202 Accepted`: Event redelivered successfully with the original event `id` and `idempotencyKey`.
- `403 Forbidden`: Admin authentication missing or invalid.
- `404 Not Found`: Delivery ID does not exist.
- `409 Conflict`: Subscription no longer subscribes to this event kind.
- `410 Gone`: Event envelope was not retained or subscription was deleted.

## Subscription management

All subscription endpoints require the `x-admin-key` header.

### Create a subscription

```http
POST /api/webhooks/subscriptions
x-admin-key: <admin_key>
Content-Type: application/json

{
  "url": "https://your-server.example.com/webhooks",
  "events": ["intent.created", "intent.settled"]
}
```

### List subscriptions

```http
GET /api/webhooks/subscriptions
x-admin-key: <admin_key>
```

### Delete a subscription

```http
DELETE /api/webhooks/subscriptions/{id}
x-admin-key: <admin_key>
```

### List dead-letter failures

```http
GET /api/webhooks/failures
x-admin-key: <admin_key>
```
