# Webhooks

**Last reviewed:** 2026-08-26

Stellar Intel can push real-time event notifications to your HTTPS endpoint instead of requiring you to poll the API. Each delivery is HMAC-SHA256 signed so you can verify authenticity before acting on the payload.

## Event types

| Kind                           | When it fires                                                        |
| ------------------------------ | -------------------------------------------------------------------- |
| `intent.created`               | An off-ramp intent is accepted for routing                           |
| `intent.settled`               | An intent reaches a terminal `completed` state                       |
| `intent.failed`                | An intent reaches a terminal `failed` state                          |
| `reputation.event_written`     | A new outcome row is appended to the reputation log                  |
| `anchor.health_status_changed` | An anchor's health status transitions (e.g. `healthy` to `degraded`) |

## Payload envelope

Every delivery is a `POST` request with `Content-Type: application/json` and a body of the form:

```json
{
  "id": "3f2a1b4c-...",
  "kind": "intent.created",
  "createdAt": "2026-07-28T12:00:00.000Z",
  "payload": { ... }
}
```

`id` is unique per event and can be used for idempotent processing.

## Signature verification

Each delivery includes two headers:

| Header                | Value                                                                 |
| --------------------- | --------------------------------------------------------------------- |
| `x-webhook-signature` | `t={unix_timestamp_sec},v1={hex_hmac}`                                |
| `x-webhook-timestamp` | Unix timestamp in seconds (same value as `t` in the signature header) |

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

If your endpoint does not respond with a 2xx status code, Stellar Intel retries up to 5 times with exponential backoff (1 s, 2 s, 4 s, 8 s between attempts). After all attempts are exhausted the delivery is moved to the dead-letter log, visible via `GET /api/webhooks/failures` (admin key required).

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
