# Webhooks

**Last reviewed:** 2026-11-25

Stellar Intel can push real-time event notifications to your HTTPS endpoint instead of requiring you to poll the API. Each delivery is HMAC-SHA256 signed so you can verify authenticity before acting on the payload.

## Event types

Twelve kinds can be subscribed to. "Live" kinds have a producer; the others are accepted
by `POST /api/webhooks/subscriptions` and start arriving once their producer ships.

| Kind                           | Fires when                                                                                                                | Status                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `intent.created`               | `POST /api/intent/offramp`, `POST /api/v1/intent/offramp` or `POST /api/v1/intent/onramp` returns 200                     | Live                           |
| `intent.settled`               | `POST /api/reputation/append` returns 201 for a `completed` outcome                                                       | Live                           |
| `intent.failed`                | `POST /api/reputation/append` returns 201 for an `error`, `expired` or `refunded` outcome                                 | Live                           |
| `reputation.event_written`     | `POST /api/reputation/append` returns 201                                                                                 | Live                           |
| `anchor.health_status_changed` | The publisher tick sees an anchor's `degraded` flag change                                                                | Live                           |
| `intent.rejected`              | An off-ramp intent route refuses a signed intent (401 bad signature, 400 missing replay fields, 409 replay, 422 no route) | Live                           |
| `intent.expired`               | An off-ramp intent route answers 410: the intent's `deadline` has passed                                                  | Live                           |
| `settlement.status_changed`    | An anchor transaction changes status                                                                                      | Subscribable; producer pending |
| `dispute.opened`               | `POST /api/reputation/dispute` returns 201                                                                                | Live                           |
| `dispute.resolved`             | `POST /api/admin/disputes` accepts or rejects a dispute (200)                                                             | Live                           |
| `oracle.published`             | The publisher tick writes outcomes, rates, metrics or probe signals on chain                                              | Live                           |
| `intent.slippage_breach`       | `POST /api/reputation/append` records an outcome below the intent's `minReceive`                                          | Live                           |

Every payload is built field by field. None carries a sender, recipient, public key,
signature, dispute reason or JWT.

### intent.created

An intent was accepted and routed. `quoteId` is `null` for an on-ramp, which has no quote:

```json
{
  "intentHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "direction": "offramp",
  "corridorId": "usdc-ngn",
  "anchorId": "cowrie",
  "quoteId": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "amount": "100",
  "sourceAsset": "USDC",
  "destinationAsset": "NGN"
}
```

### intent.settled

A signed outcome reports the intent completed:

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

A signed outcome reports the intent ended in `error`, `expired` or `refunded`:

```json
{
  "intentHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "anchorId": "cowrie",
  "corridor": "usdc-ngn",
  "outcome": "error"
}
```

### reputation.event_written

A new outcome row was appended to the reputation log:

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

Emitted by the publisher tick (every five minutes) when an anchor's `degraded` flag in
the nightly health ledger (`constants/anchor-health.json`) differs from the last
snapshot it notified, so a change arrives within a tick of the deploy that carries
it. One event per anchor, in anchor-id order:

```json
{
  "anchorId": "cowrie",
  "from": "healthy",
  "to": "degraded",
  "lastCheckedAt": "2026-10-25T00:00:00.000Z",
  "lastError": "stellar.toml returned HTTP 503"
}
```

`from` and `to` are `healthy` or `degraded`. The first run only records a baseline and
emits nothing, and without a database there is no baseline to keep, so nothing is
emitted. `lastCheckedAt` and `lastError` are `null` when the ledger has none.

### intent.rejected

An off-ramp intent route refused a signed intent. `reason` is one of `invalid_signature`, `missing_replay_fields`, `replay_detected` or `no_route`, never free text:

```json
{
  "intentHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "direction": "offramp",
  "reason": "replay_detected",
  "sourceAsset": "USDC",
  "destinationAsset": "NGN",
  "amount": "100"
}
```

### intent.expired

An off-ramp intent arrived after its signed `deadline`:

```json
{
  "intentHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "direction": "offramp",
  "deadline": "2026-11-20T10:05:00.000Z",
  "sourceAsset": "USDC",
  "destinationAsset": "NGN",
  "amount": "100"
}
```

### settlement.status_changed

An anchor transaction moved from one status to another. `from` is `null` for the first status seen, and `intentHash` is `null` when the transaction has no intent. Subscribable; the producer is pending:

```json
{
  "anchorId": "cowrie",
  "transactionId": "82fhs729f63dh0v4",
  "protocol": "sep24",
  "direction": "withdraw",
  "from": "pending_anchor",
  "to": "completed",
  "terminal": true,
  "intentHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "observedAt": "2026-11-20T10:10:00.000Z"
}
```

### dispute.opened

A signed dispute was filed. Who filed it and what they wrote are not part of the event:

```json
{
  "disputeId": "5b0e2f5e-6c1d-4a0e-9b1f-2d3c4e5f6a7b",
  "intentHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "anchorId": "cowrie",
  "createdAt": "2026-11-20T11:00:00.000Z"
}
```

### dispute.resolved

An admin accepted or rejected a dispute:

```json
{
  "disputeId": "5b0e2f5e-6c1d-4a0e-9b1f-2d3c4e5f6a7b",
  "intentHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "anchorId": "cowrie",
  "status": "accepted",
  "resolvedAt": "2026-11-21T09:00:00.000Z"
}
```

### oracle.published

The publisher tick wrote something on chain. It is not sent when the gate is closed or nothing was written:

```json
{
  "network": "testnet",
  "contractId": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  "txHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "outcomesPublished": 2,
  "corridorRatesPublished": 3,
  "corridorMetricsPublished": 3,
  "probeSignalsPublished": 0,
  "publishedAt": "2026-11-20T12:00:00.000Z"
}
```

### intent.slippage_breach

Emitted when an outcome is appended to the reputation log and the amount it reports as
delivered is below the `minReceive` the intent was signed with. It is sent after the
other events of the same outcome (`reputation.event_written`, then `intent.settled`):

```json
{
  "intentHash": "3f6a0c1d9b2e47f58a6c0d1e2f3a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c",
  "anchorId": "cowrie",
  "corridor": "ngnt-ngn",
  "minReceive": "1400",
  "amountOut": "1350",
  "shortfall": "50",
  "shortfallBps": 357,
  "evidenceHash": "9c1e7a44d0b25f6831c7e9a2b4d6f8013a5c7e9b1d3f507294b6d8fa1c3e5072",
  "status": "detected",
  "detectedAt": "2026-11-20T12:00:00.000Z"
}
```

`minReceive`, `amountOut` and `shortfall` are decimal strings, and `shortfallBps` is the
shortfall in basis points of `minReceive`, rounded down. `status` is always `detected`:
the breach has been recorded and has not yet been checked against the Stellar payment.
`evidenceHash` identifies the evidence kept with the breach. The evidence itself, the
signer's account and the anchor's transaction id are not sent.

## Payload envelope

Every delivery is a `POST` request with `Content-Type: application/json` and a body of the form:

```json
{
  "id": "3f2a1b4c-9f8e-4a6d-b2a1-0e1f2a3b4c5d",
  "kind": "intent.created",
  "createdAt": "2026-07-28T12:00:00.000Z",
  "idempotencyKey": "intent.created:<quoteId>",
  "payload": { ... }
}
```

De-duplicate on `idempotencyKey`, not on `id`. The key is derived from the fact the event
reports, so the same fact always has the same key, even when a producer emits it again
(for example after a failed snapshot write) or an operator resends it. The formats are:

| Kind                           | `idempotencyKey`                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `intent.created`               | `intent.created:<quoteId>` (off-ramp), `intent.created:onramp:<intentHash>` (on-ramp) |
| `intent.settled`               | `intent.settled:<intentHash>`                                                         |
| `intent.failed`                | `intent.failed:<intentHash>`                                                          |
| `reputation.event_written`     | `reputation.event_written:<intentHash>`                                               |
| `anchor.health_status_changed` | `anchor.health_status_changed:<anchorId>:<to>:<lastCheckedAt or none>`                |
| `intent.rejected`              | `intent.rejected:<reason>:<intentHash>`                                               |
| `intent.expired`               | `intent.expired:<intentHash>`                                                         |
| `dispute.opened`               | `dispute.opened:<disputeId>`                                                          |
| `dispute.resolved`             | `dispute.resolved:<disputeId>`                                                        |
| `oracle.published`             | `oracle.published:<txHash>`, or `oracle.published:<publishedAt>` without one          |
| `intent.slippage_breach`       | `intent.slippage_breach:<intentHash>`                                                 |

## Signature verification

Each delivery includes four headers:

| Header                      | Value                                                                 |
| --------------------------- | --------------------------------------------------------------------- |
| `x-webhook-signature`       | `t={unix_timestamp_sec},v1={hex_hmac}`                                |
| `x-webhook-timestamp`       | Unix timestamp in seconds (same value as `t` in the signature header) |
| `x-webhook-id`              | The event's `id`                                                      |
| `x-webhook-idempotency-key` | The event's `idempotencyKey`                                          |

A runnable consumer that verifies signatures and de-duplicates on the idempotency key is
in [`examples/webhook-consumer/`](../examples/webhook-consumer/).

### How to verify

1. Extract `t` (timestamp) and `v1` (signature) from `x-webhook-signature`.
2. Build the signed payload string: concatenate the timestamp, a literal `.`, and the raw request body bytes exactly as received (do not parse and re-serialize).
3. Compute `HMAC-SHA256(your_secret, signed_payload)` and encode as lowercase hex.
4. Compare your computed value to `v1` using **constant-time** comparison to prevent timing attacks.
5. Reject the request if the timestamp is more than 5 minutes old (replay protection).

### Verification example (Node.js)

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
  if (Math.abs(now - timestamp) > 300) return false; // 5-minute window

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
```

> Use the raw body bytes, not `JSON.stringify(req.body)`. Any whitespace or key-ordering difference will break verification.

## Retry and dead-letter

If your endpoint does not respond with a 2xx status code, Stellar Intel makes up to 5 delivery attempts (the first plus 4 retries) with exponential backoff (1 s, 2 s, 4 s, 8 s between attempts). After all attempts are exhausted the delivery is moved to the dead-letter log, visible via `GET /api/webhooks/failures` (admin key required).

Your endpoint should return `200` (or any 2xx) as quickly as possible and process the event asynchronously to avoid triggering retries due to slow processing.

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

Response `201`:

```json
{
  "id": "3f2a1b4c-...",
  "url": "https://your-server.example.com/webhooks",
  "events": ["intent.created", "intent.settled"],
  "secret": "a9f3..."
}
```

The `secret` is returned **only once**. Store it immediately — it cannot be retrieved again.

### List subscriptions

```http
GET /api/webhooks/subscriptions
x-admin-key: <admin_key>
```

Secrets are omitted from the list response.

### Delete a subscription

```http
DELETE /api/webhooks/subscriptions/{id}
x-admin-key: <admin_key>
```

Returns `204 No Content` on success.

### List dead-letter failures

```http
GET /api/webhooks/failures
x-admin-key: <admin_key>
```

Returns all delivery records that exhausted retries without a successful response.

### List deliveries

```http
GET /api/webhooks/deliveries?status=dead_letter&subscriptionId=...&eventId=...&limit=100
x-admin-key: <admin_key>
```

Returns logged delivery records, newest first. Every filter is optional: `status` is
`success`, `failed` or `dead_letter`, `subscriptionId` and `eventId` narrow to one
subscription or event, and `limit` is 1 to 500 (default 100).

### Redeliver a logged delivery

```http
POST /api/webhooks/deliveries/{id}/redeliver
x-admin-key: <admin_key>
```

Sends one logged delivery to its subscription again, for use once a subscriber has fixed an outage. `{id}` is the `id` of a delivery record, as listed by `GET /api/webhooks/failures` or `GET /api/webhooks/deliveries`. Any logged delivery can be resent, not only a dead-lettered one.

The stored event goes out unchanged: the same `id`, `createdAt`, `idempotencyKey` and `payload`, and so the same `x-webhook-id` and `x-webhook-idempotency-key` headers. Only the timestamp and the signature are new. A consumer that de-duplicates on the event `id` or on the idempotency key processes a resent event once.

Response `202`:

```json
{
  "redelivered": true,
  "eventId": "3f2a1b4c-...",
  "subscriptionId": "9e8d7c6b-..."
}
```

`202` means the delivery was attempted, with the usual retries, before the response was sent. It does not mean the subscriber accepted it. The attempt is logged as a new delivery record and the original record is left as it was, so read the new record's `status` to see how it went.

| Status | `code`                    | Meaning                                                     |
| ------ | ------------------------- | ----------------------------------------------------------- |
| `403`  | `FORBIDDEN`               | Missing or invalid admin key                                |
| `404`  | `NOT_FOUND`               | No delivery record has this id                              |
| `410`  | `EVENT_NOT_RETAINED`      | The event is not in the event store, so it cannot be resent |
| `410`  | `SUBSCRIPTION_DELETED`    | The subscription the delivery went to was deleted           |
| `409`  | `EVENT_KIND_UNSUBSCRIBED` | The subscription no longer lists the event's kind           |
| `429`  | `RATE_LIMITED`            | More than 10 requests in a minute                           |
