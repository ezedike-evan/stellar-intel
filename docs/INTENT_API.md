# Intent API

> **Intent = a signed statement of desired outcome.** The user says _"withdraw
> $100 USDC to this NGN account, at or better than this rate, before this
> deadline"_. Stellar Intel routes that intent to the anchor that can
> satisfy it. The intent is the protocol-level primitive — everything else
> (quotes, fills, scores) is derived from it.
>
> This document is the contract between the Stellar Intel API and any
> consumer — the web app, the SDK, the MCP server, a third-party integrator,
> an AI agent.

---

## Table of contents

- [Intent lifecycle](#intent-lifecycle)
- [Schema](#schema)
  - [Common fields](#common-fields)
  - [`offramp` intent](#offramp-intent)
  - [`onramp` intent _(v2)_](#onramp-intent-v2)
  - [`swap` intent _(v2)_](#swap-intent-v2)
- [Canonicalisation and hashing](#canonicalisation-and-hashing)
- [Signing](#signing)
- [Replay protection](#replay-protection)
- [Endpoints](#endpoints)
- [Examples](#examples)
  - [`curl`](#curl)
  - [TypeScript](#typescript)
- [Error codes](#error-codes)

---

## Intent lifecycle

```
draft → quoted → signed → submitted → fulfilled
                                    ↘ failed
                                    ↘ expired
```

- **draft.** User has assembled the intent but not fetched quotes yet. Not
  persisted on the server.
- **quoted.** Router has returned a ranked list of anchor quotes. Intent now
  has a `routeId` it can commit to.
- **signed.** User has signed the canonical-JSON hash with their Stellar
  secret key. Intent is now binding.
- **submitted.** Stellar Intel has relayed the signed intent to the chosen
  anchor (SEP-24 interactive flow) and records the anchor transaction ID.
- **fulfilled.** Anchor reports the transaction as `completed`. Reputation
  writes a success observation.
- **failed / expired.** Terminal, with reason code. Reputation writes a
  failure observation, including a category (`anchor_unavailable`,
  `rate_drift`, `user_abort`, `kyc_blocked`, …).

The state machine is the **only** correct way to reason about an intent;
polling a single "is it done yet?" flag is not sufficient.

---

## Schema

Every intent is a JSON object with a top-level `kind` discriminator.

### Common fields

| Field          | Type     | Notes                                                                               |
| -------------- | -------- | ----------------------------------------------------------------------------------- |
| `kind`         | enum     | `offramp` · `onramp` · `swap` (v2) · `yield` (v2)                                   |
| `version`      | `"1.0"`  | Schema version. Bumps are additive only within a major.                             |
| `user`         | string   | User's Stellar account G-address.                                                   |
| `nonce`        | string   | 128-bit hex. Caller-chosen, must be unique per user per 30 days.                    |
| `deadline`     | RFC-3339 | Hard expiry. Server rejects submission after this. Max 10 minutes from `createdAt`. |
| `createdAt`    | RFC-3339 | Client-side timestamp. Server tolerates ±2 minutes of skew.                         |
| `minNetLanded` | string   | Decimal string. Minimum acceptable net landed value, denominated in `targetAsset`.  |

All numeric values are **decimal strings**, never JS numbers. Amounts are
the raw unit (e.g. `"100.00"` NGN, not `"10000"` kobo).

### `offramp` intent

```json
{
  "kind": "offramp",
  "version": "1.0",
  "user": "GD3Z…",
  "nonce": "7b1c…9a4d",
  "createdAt": "2026-04-24T14:12:05Z",
  "deadline": "2026-04-24T14:22:05Z",
  "sourceAsset": {
    "code": "USDC",
    "issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
  },
  "sourceAmount": "100.00",
  "targetAsset": { "code": "NGN" },
  "beneficiary": {
    "kind": "bank-account",
    "country": "NG",
    "bankCode": "058",
    "accountNumber": "0123456789",
    "accountName": "Adaora Nnamdi"
  },
  "minNetLanded": "140500.00"
}
```

### `onramp` intent _(v2)_

Placeholder — same fields flipped. Ships with wave 2.1.

### `swap` intent _(v2)_

Placeholder — `sourceAsset → targetAsset` with a minimum out. Routed
through Stellar's native DEX or Soroswap/Aquarius pools.

---

## Canonicalisation and hashing

Signing must be deterministic across clients. We canonicalise the intent
object before hashing:

1. Remove all keys whose value is `null` or `undefined`.
2. Sort all object keys lexicographically (deep).
3. Serialise with no whitespace, no trailing newline, UTF-8.
4. Hash with **SHA-256**. The hex digest is the intent's `intentHash`.

See [`docs/CANONICAL_JSON.md`](CANONICAL_JSON.md) for the full rules and
test vectors. A TypeScript helper is exported from
`@stellarintel/sdk/canonical` and the MCP server uses the same
implementation — drift between clients is detected by a unit test that
hashes a frozen corpus of intents.

---

## Signing

The signature covers `intentHash` only.

- **Algorithm**: Ed25519 via the user's Stellar account keypair.
- **Domain separator**: `b"STELLAR_INTEL_INTENT_V1\0"` prepended to the
  digest bytes before signing. Prevents cross-protocol signature reuse.
- **Encoding**: base64 (RFC 4648), no padding trimming. 64-byte raw
  signature.

The signed envelope submitted to the server is:

```json
{
  "intent": {
    /* the canonical intent */
  },
  "routeId": "r_2ZQ9…",
  "signature": "base64(ed25519(sig))",
  "publicKey": "GD3Z…"
}
```

`publicKey` must match `intent.user`. The server verifies:

1. `publicKey == intent.user`.
2. `signature` verifies against `intentHash(canonical(intent))` under
   the domain separator.
3. `deadline > now`.
4. `(user, nonce)` has not been seen before (replay protection, below).
5. `routeId` references a quote still within its `validUntil`.

---

## Replay protection

Replay protection is enforced **server-side** by the router.

- The router maintains a `seen_intents` table keyed by
  `(user, nonce, intentHash)`.
- An inserted row expires 30 days after `deadline`, after which the nonce
  is reusable.
- The router rejects any submission whose `(user, nonce)` already exists,
  even if `intentHash` differs (which itself is suspicious — always a
  client bug).
- Nonces must be **unguessable**: use a CSPRNG, not a counter. Guessable
  nonces let an attacker grief a user by pre-submitting a canonical hash
  they cannot sign.

For `signed → submitted → fulfilled`, idempotency is keyed by
`intentHash`. A client that retries submission after a transport error
receives the original server response, not a duplicate anchor call.

---

## Endpoints

Base URL (production): `https://stellar-intel.vercel.app/api/v1`.

| Method | Path                         | Purpose                                                                |
| ------ | ---------------------------- | ---------------------------------------------------------------------- |
| `POST` | `/intents/quote`             | Submit a draft intent, receive a ranked list of anchor quotes.         |
| `POST` | `/intents/submit`            | Submit a signed envelope. Returns the anchor interactive URL (SEP-24). |
| `GET`  | `/intents/:intentHash`       | Poll the state.                                                        |
| `GET`  | `/public/scores`             | Public anchor reputation snapshot (no auth).                           |
| `GET`  | `/public/scores/:anchorId`   | Per-anchor composite + component breakdown.                            |
| `POST` | `/webhooks/anchor/:anchorId` | SEP-24 callback (anchor → us). Signed.                                 |

All `v1` responses are JSON with an `envelope` form:

```json
{
  "data": {
    /* payload */
  },
  "meta": { "requestId": "req_…", "tookMs": 132 },
  "error": null
}
```

Errors use the same envelope with `data: null` and a non-null `error`.

---

## Examples

### `curl`

```bash
# 1. Quote
curl -s -X POST https://stellar-intel.vercel.app/api/v1/intents/quote \
  -H 'content-type: application/json' \
  -d @intent.json \
  | jq '.data.routes[0]'

# 2. Sign off-line (Freighter / CLI) — see sdk example below.

# 3. Submit signed envelope
curl -s -X POST https://stellar-intel.vercel.app/api/v1/intents/submit \
  -H 'content-type: application/json' \
  -d @signed.json

# 4. Poll
INTENT_HASH="$(jq -r .intentHash signed.json)"
watch -n 3 "curl -s https://stellar-intel.vercel.app/api/v1/intents/$INTENT_HASH | jq '.data.state'"
```

### TypeScript

```ts
import { canonicalize, hashIntent, type OfframpIntent } from '@stellarintel/sdk';
import { getPublicKey, signMessage } from '@stellar/freighter-api';

const intent: OfframpIntent = {
  kind: 'offramp',
  version: '1.0',
  user: await getPublicKey(),
  nonce: crypto.randomUUID().replace(/-/g, ''),
  createdAt: new Date().toISOString(),
  deadline: new Date(Date.now() + 5 * 60_000).toISOString(),
  sourceAsset: { code: 'USDC', issuer: 'GA5Z…' },
  sourceAmount: '100.00',
  targetAsset: { code: 'NGN' },
  beneficiary: {
    /* … */
  },
  minNetLanded: '140500.00',
};

const quoteRes = await fetch('/api/v1/intents/quote', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: canonicalize(intent),
}).then((r) => r.json());

const route = quoteRes.data.routes[0]; // best by net landed value
const hash = hashIntent(intent); // hex digest, SHA-256
const sig = await signMessage(hash, { domain: 'STELLAR_INTEL_INTENT_V1' });

const submit = await fetch('/api/v1/intents/submit', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    intent,
    routeId: route.id,
    signature: sig,
    publicKey: intent.user,
  }),
}).then((r) => r.json());

window.location.href = submit.data.interactiveUrl;
```

---

## Error codes

Every error has a stable `code` string. Safe to switch on.

| Code                       | HTTP | Meaning                                                              |
| -------------------------- | ---- | -------------------------------------------------------------------- |
| `intent.invalid_schema`    | 400  | Failed JSON-schema validation. `error.details` has the JSON Pointer. |
| `intent.expired_deadline`  | 400  | `deadline` is in the past at submission time.                        |
| `intent.signature_invalid` | 401  | Ed25519 signature failed verification.                               |
| `intent.signer_mismatch`   | 401  | `publicKey` does not match `intent.user`.                            |
| `intent.nonce_reused`      | 409  | `(user, nonce)` already seen; pick a new nonce.                      |
| `intent.route_stale`       | 409  | `routeId` quote has expired — re-quote and resubmit.                 |
| `intent.rate_drift`        | 409  | Anchor quote now below `minNetLanded`.                               |
| `anchor.unavailable`       | 502  | Chosen anchor failed SEP-24 handshake. Router should re-route.       |
| `anchor.rate_limited`      | 429  | Anchor throttled us. Retry-After header set.                         |
| `internal.router_down`     | 503  | Router pipeline broken; caller should back off.                      |

A contributor-facing note: **never swallow an error code.** If a caller
cannot recover, surface the `code` verbatim so support can search it.
