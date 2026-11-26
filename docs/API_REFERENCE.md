# API Reference

**Specification Version:** `1.3.0`  
**OpenAPI:** `3.1.0`

Intent router and anchor rate aggregation API for the Stellar Intel platform.

## Public v1 surface

The stable, supported surface is namespaced under `/api/v1/...`; unversioned
routes are internal and may change without notice. Every v1 response follows
the hardening contract (see `lib/api/v1.ts`):

- **Error envelope** — errors return `{ "error": { "code", "message", "requestId" } }`.
- **Rate-limit headers** — `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
  `X-RateLimit-Reset` on every response; `Retry-After` on a `429`.
- **Idempotency** — send an `Idempotency-Key` header on mutating endpoints
  (e.g. `POST /api/v1/intent/offramp`); a retried request replays the original
  response (`Idempotency-Replayed: true`) instead of creating a second intent.

## Servers

- `https://stellar-intel.vercel.app/api/v1` — Production (public v1)
- `https://stellar-intel.vercel.app` — Production (internal, unversioned)
- `http://localhost:3000` — Development

## Table of Contents

- **Admin**
  - [`GET /api/admin/audit/export`](#get-apiadminauditexport)
  - [`GET /api/admin/disputes`](#get-apiadmindisputes)
  - [`POST /api/admin/disputes`](#post-apiadmindisputes)
  - [`GET /api/admin/keys`](#get-apiadminkeys)
  - [`POST /api/admin/keys`](#post-apiadminkeys)
  - [`DELETE /api/admin/keys/{keyId}`](#delete-apiadminkeyskeyid)
- **Anchors**
  - [`GET /api/v1/anchor-health/ledger`](#get-apiv1anchor-healthledger)
  - [`GET /api/v1/anchors/census`](#get-apiv1anchorscensus)
  - [`GET /api/v1/anchors/{id}/health`](#get-apiv1anchorsidhealth)
  - [`GET /api/v1/anchors/{id}/price-history`](#get-apiv1anchorsidprice-history)
  - [`GET /api/v1/anchors/{id}/quote-gap`](#get-apiv1anchorsidquote-gap)
  - [`GET /api/v1/sep38/readiness`](#get-apiv1sep38readiness)
- **Auth**
  - [`POST /api/v1/auth/token`](#post-apiv1authtoken)
- **Intent**
  - [`POST /api/intent`](#post-apiintent)
  - [`POST /api/intent/offramp`](#post-apiintentofframp)
  - [`POST /api/intent/status`](#post-apiintentstatus)
  - [`POST /api/v1/intent/offramp`](#post-apiv1intentofframp)
  - [`POST /api/v1/intent/onramp`](#post-apiv1intentonramp)
- **On-ramp**
  - [`GET /api/v1/onramp/quote`](#get-apiv1onrampquote)
- **Rates**
  - [`GET /api/deposit-rates/{corridor}`](#get-apideposit-ratescorridor)
  - [`GET /api/rates/{corridor}`](#get-apiratescorridor)
  - [`GET /api/snapshot`](#get-apisnapshot)
  - [`GET /api/v1/corridors/{corridor}/volume-savings`](#get-apiv1corridorscorridorvolume-savings)
- **Refunds**
  - [`POST /api/refunds/ack`](#post-apirefundsack)
  - [`GET /api/refunds/{intentHash}`](#get-apirefundsintenthash)
- **Reputation**
  - [`GET /api/reputation/actuarial`](#get-apireputationactuarial)
  - [`POST /api/reputation/append`](#post-apireputationappend)
  - [`GET /api/reputation/dispute`](#get-apireputationdispute)
  - [`POST /api/reputation/dispute`](#post-apireputationdispute)
  - [`POST /api/reputation/dispute/appeal`](#post-apireputationdisputeappeal)
  - [`GET /api/reputation/leaderboard`](#get-apireputationleaderboard)
  - [`GET /api/reputation/probe-coverage`](#get-apireputationprobe-coverage)
  - [`GET /api/reputation/sdf-export`](#get-apireputationsdf-export)
  - [`GET /api/reputation/{anchor}`](#get-apireputationanchor)
  - [`GET /api/reputation/{anchor}/history`](#get-apireputationanchorhistory)
  - [`GET /api/reputation/{anchor}/sla`](#get-apireputationanchorsla)
  - [`GET /api/v1/disputes/log`](#get-apiv1disputeslog)
  - [`GET /api/v1/slippage-breaches`](#get-apiv1slippage-breaches)
  - [`GET /api/v1/slippage-breaches/{intentHash}`](#get-apiv1slippage-breachesintenthash)
  - [`GET /api/v1/slippage-compliance`](#get-apiv1slippage-compliance)
  - [`GET /v1/public/scores`](#get-v1publicscores)
- **SEP-10**
  - [`POST /api/sep10/client-domain`](#post-apisep10client-domain)
- **SEP-6**
  - [`POST /api/sep6/withdraw`](#post-apisep6withdraw)
- **System**
  - [`POST /api/admin/cache/invalidate`](#post-apiadmincacheinvalidate)
  - [`POST /api/graphql`](#post-apigraphql)
  - [`POST /api/mcp`](#post-apimcp)
  - [`GET /api/mcp/ping`](#get-apimcpping)
  - [`GET /api/metrics`](#get-apimetrics)
  - [`GET /api/publisher/health`](#get-apipublisherhealth)
  - [`GET /api/publisher/tick`](#get-apipublishertick)
  - [`POST /api/reputation/dispute-sweep`](#post-apireputationdispute-sweep)
  - [`GET /api/reputation/reconcile`](#get-apireputationreconcile)
  - [`GET /api/reputation/reconcile-volume-savings`](#get-apireputationreconcile-volume-savings)
  - [`POST /api/reputation/refresh`](#post-apireputationrefresh)
  - [`GET /api/status`](#get-apistatus)
  - [`GET /api/v1/health`](#get-apiv1health)
  - [`GET /api/v1/usage`](#get-apiv1usage)
  - [`GET /api/webhooks/deliveries`](#get-apiwebhooksdeliveries)
  - [`POST /api/webhooks/deliveries/{id}/redeliver`](#post-apiwebhooksdeliveriesidredeliver)
  - [`GET /api/webhooks/failures`](#get-apiwebhooksfailures)
  - [`GET /api/webhooks/subscriptions`](#get-apiwebhookssubscriptions)
  - [`POST /api/webhooks/subscriptions`](#post-apiwebhookssubscriptions)
  - [`DELETE /api/webhooks/subscriptions/{id}`](#delete-apiwebhookssubscriptionsid)

## Admin

### `GET /api/admin/audit/export`

**Summary:** Export audit log (admin)  

Export audit log events over a date range as NDJSON or CSV. Requires adminKey or callerKey with admin scope.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `from` | `query` | `string` | **Yes** | Start of ISO 8601 date range (inclusive) |
| `to` | `query` | `string` | **Yes** | End of ISO 8601 date range (exclusive) |
| `format` | `query` | `"ndjson" | "csv"` | No | Export format ("ndjson" or "csv", default "ndjson") |
| `callerId` | `query` | `string` | No | Filter by caller id (e.g. "anonymous" or "key:<16-hex>") |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Audit log export stream | `application/x-ndjson` | `string` |
| `200` | Audit log export stream | `text/csv` | `string` |
| `400` | Validation error | `application/json` | `ApiError` |
| `401` | Authentication required | `application/json` | `ApiError` |
| `403` | Forbidden | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `GET /api/admin/disputes`

**Summary:** List disputes (admin)  

Lists all disputes. Requires admin authentication.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | List of disputes | `application/json` | `DisputeAdmin[]` |
| `401` | Admin access required | `application/json` | `ApiError` |

---

### `POST /api/admin/disputes`

**Summary:** Resolve a dispute (admin)  

Accepts or rejects a dispute. Requires admin authentication.

#### Request Body

**Content-Type:** `application/json`

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **Yes** | - |
| `action` | `"accept" | "reject" | "escalate"` | **Yes** | - |
| `rationale` | `string` | No | - |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Updated dispute | `application/json` | `DisputeAdmin` |
| `400` | Invalid request | `application/json` | `ApiError` |
| `401` | Admin access required | `application/json` | `ApiError` |
| `404` | Dispute not found | `application/json` | `ApiError` |
| `409` | Conflict: dispute not open or cannot escalate | `application/json` | `ApiError` |

---

### `GET /api/admin/keys`

**Summary:** List caller API keys (admin)  

Lists issued caller keys newest first, without their hashes.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Caller keys, newest first | `application/json` | `ApiKeyRecord[]` |
| `403` | Admin key required | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `POST /api/admin/keys`

**Summary:** Issue a caller API key (admin)  

Issues a caller key and returns the raw key exactly once, at creation. Only the SHA-256 hash is stored. Authenticated by ADMIN_SECRET_KEY only — a caller key with the `admin` scope cannot mint keys.

#### Request Body

**Content-Type:** `application/json`

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `name` | `string` | **Yes** | Human label for the key holder |
| `scopes` | `"quotes:read" | "intents:write" | "reputation:write" | "admin"[]` | **Yes** | Non-empty, no duplicates |
| `tier` | `"standard" | "partner"` | No | Defaults to standard |
| `expiresInDays` | `integer` | No | - |
| `maxIntentAmount` | `string` | No | - |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `201` | Caller key issued. The response is not cacheable. | `application/json` | `CreatedApiKey` |
| `400` | Validation error | `application/json` | `ApiError` |
| `403` | Admin key required | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `DELETE /api/admin/keys/{keyId}`

**Summary:** Revoke a caller API key (admin)  

Revokes a caller key immediately. Answers 404 for an unknown or already revoked key.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `keyId` | `path` | `string` | **Yes** | 16 lowercase hex characters |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `204` | Key revoked | - | - |
| `400` | Malformed keyId | `application/json` | `ApiError` |
| `403` | Admin key required | `application/json` | `ApiError` |
| `404` | Unknown or already revoked key | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

## Anchors

### `GET /api/v1/anchor-health/ledger`

**Summary:** Get the anchor health ledger for a date  

Publishes the nightly anchor health ledger as a dated artifact. Without `date`, returns the ledger this deployment was built with. With `date` (YYYY-MM-DD), returns the ledger as it stood on that date, resolved from the git history of `constants/anchor-health.json` — so the series is fetchable without cloning the repository. The committed file remains the source of truth; nothing is mirrored server-side. A dated response is immutable and cached as such. Required scope: quotes:read.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `date` | `query` | `string` | No | Ledger date to retrieve, YYYY-MM-DD. Omit for the latest. |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | The anchor health ledger for the requested date | `application/json` | `AnchorHealthLedgerArtifact` |
| `400` | Malformed date | `application/json` | `ApiError` |
| `404` | No ledger exists on or before the requested date | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |
| `502` | The ledger history could not be read | `application/json` | `ApiError` |

---

### `GET /api/v1/anchors/census`

**Summary:** Get the anchor census  

Serves the committed anchor census (constants/anchor-census-rows.json), covering every surveyed anchor — routable, health-only, or merely listed — not only the anchors registered for routing. Optionally filtered to a single tier. Required scope: quotes:read.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `tier` | `query` | `"routable" | "health-only" | "listed"` | No | Restrict the response to one tier. Omit for every row. |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | The anchor census, optionally filtered by tier | `application/json` | `AnchorCensusResponse` |
| `400` | Invalid `tier` value | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `GET /api/v1/anchors/{id}/health`

**Summary:** Get anchor health status  

Returns the anchor's current health status, last-probe timestamp, and score breakdown. Returns 'unknown' or 'stale' when probes haven't run recently — honest degradation rather than fabricated data. Required scope: quotes:read.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `path` | `string` | **Yes** | Anchor identifier (e.g. moneygram, cowrie, anclap) |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Anchor health status | `application/json` | `AnchorHealthResponse` |
| `400` | Invalid anchor ID | `application/json` | `ApiError` |
| `404` | Anchor not found | `application/json` | `ApiError` |
| `429` | Rate limit exceeded | `application/json` | `object` |

---

### `GET /api/v1/anchors/{id}/price-history`

**Summary:** Get anchor SEP-38 price history  

Returns recorded SEP-38 price observations for an anchor corridor, downsampled to at most 500 points (evenly spaced; first and last retained). Required scope: quotes:read.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `path` | `string` | **Yes** | Anchor identifier |
| `corridor` | `query` | `string` | No | Corridor id served by the anchor (default: first corridor) |
| `days` | `query` | `integer` | No | Lookback window in days, 1–90 (default 7) |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Price history series | `application/json` | `object` |
| `400` | Invalid params or corridor not served | `application/json` | `ApiError` |
| `404` | Unknown anchor | `application/json` | `ApiError` |
| `429` | Rate limit exceeded | `application/json` | `ApiError` |
| `503` | Quote store unavailable | `application/json` | `ApiError` |

---

### `GET /api/v1/anchors/{id}/quote-gap`

**Summary:** Get how far an anchor lands from the rate it quoted  

Signed gap between the rate shown before execution and the rate that landed, over completed, undisputed withdrawals in the window. Negative means users received less than quoted. Stands in for SEP-38 firm quotes, which most anchors do not offer. Null statistics mean no samples. Required scope: quotes:read.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `path` | `string` | **Yes** | Anchor identifier |
| `window` | `query` | `object` | No | Lookback window in days: 7, 30 or 90 (default 30) |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Quote-gap statistics | `application/json` | `object` |
| `400` | Invalid window | `application/json` | `ApiError` |
| `404` | Unknown anchor | `application/json` | `ApiError` |
| `429` | Rate limit exceeded | `application/json` | `ApiError` |
| `503` | Reputation store unavailable | `application/json` | `ApiError` |

---

### `GET /api/v1/sep38/readiness`

**Summary:** Get SEP-38 firm-quote readiness per anchor  

For each registered anchor: whether the operator declares SEP-38, whether its stellar.toml advertises a quote server, whether that server’s /info answers, and whether it lists the anchor’s registered asset. Checked live and cached for ten minutes. Required scope: quotes:read.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Readiness per anchor | `application/json` | `object` |
| `429` | Rate limit exceeded | `application/json` | `ApiError` |

---

## Auth

### `POST /api/v1/auth/token`

**Summary:** Exchange an API key for a short-lived token (v1)  

Mints a token of at most 15 minutes carrying a subset of the calling key's scopes, for handing to an agent. Requires an API key: tokens and anonymous calls cannot mint tokens. The response is sent with `Cache-Control: no-store`.

#### Request Body

**Content-Type:** `application/json`

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `scopes` | `"quotes:read" | "intents:write" | "reputation:write" | "admin"[]` | No | Unique scopes to carry; each must be held by the key. Defaults to all of the key's scopes. |
| `ttlSeconds` | `integer` | No | Token lifetime in seconds (60-900, default 900) |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Token issued | `application/json` | `TokenExchangeResponse` |
| `400` | Validation error | `application/json` | `ApiError` |
| `401` | An API key is required (`api_key_required`), or the credential is invalid | `application/json` | `ApiError` |
| `403` | A requested scope is not held by the key (`insufficient_scope`) | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |
| `503` | Caller tokens are not enabled on this deployment (`tokens_unavailable`) | `application/json` | `ApiError` |

---

## Intent

### `POST /api/intent`

**Summary:** Submit an intent (unversioned)  

Internal, unversioned intent endpoint. Prefer `POST /api/v1/intent/offramp`, which carries the v1 hardening contract and idempotency guarantees.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Intent accepted | `application/json` | `OfframpIntentResponse` |
| `400` | Validation error | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `POST /api/intent/offramp`

**Summary:** Submit an off-ramp intent  

Resolves an anchor route for the given asset corridor, builds an unsigned Stellar payment transaction, and returns a quote ID. Every response carries an `API-Version` header and `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers. Send an `Idempotency-Key` header to safely retry: a repeated key within 24h replays the original response (flagged with `Idempotency-Replayed: true`) instead of re-executing the request. Only 200 and 400 responses are cached under a key; a 500 is never cached, so a retry with the same key will try again.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `Idempotency-Key` | `header` | `string` | No | Client-generated key. A repeated value within 24h replays the original response. |

#### Request Body

**Content-Type:** `application/json`

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `type` | `"offramp"` | **Yes** | - |
| `sourceAsset` | `string` | **Yes** | - |
| `destinationAsset` | `string` | **Yes** | - |
| `amount` | `string` | **Yes** | - |
| `sender` | `string` | **Yes** | Stellar public key of the sender |
| `recipient` | `string` | **Yes** | Destination address for the payout |
| `nonce` | `string` | No | 128-bit random hex, required for replay protection when the intent is signed |
| `deadline` | `string` | No | RFC 3339 datetime after which the intent must not execute; required when the intent is signed |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `201` | Route resolved and unsigned transaction built | `application/json` | `OfframpIntentResponse` |
| `400` | Validation error or no route found | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |
| `500` | Transaction build failure | `application/json` | `ApiError` |

---

### `POST /api/intent/status`

**Summary:** Observe anchor transaction status  

Observes the current settlement status of a SEP-24 or SEP-6 transaction server-side. Forwards the caller-provided SEP-10 JWT for a single read of the anchor transfer server without storing or logging it. Tracks status transitions to support webhook notifications.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `authorization` | `header` | `string` | **Yes** | Bearer <jwt> containing SEP-10 authentication token |

#### Request Body

**Content-Type:** `application/json`

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `anchorId` | `string` | **Yes** | Registered anchor ID |
| `transferServer` | `string` | **Yes** | HTTPS URL of the anchor transfer server |
| `transactionId` | `string` | **Yes** | Anchor transaction ID |
| `protocol` | `"sep24" | "sep6"` | **Yes** | Transfer protocol used |
| `direction` | `"withdraw" | "deposit"` | **Yes** | Transaction direction |
| `intentHash` | `string` | No | 64-hex canonical intent hash |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Status observation recorded | `application/json` | `object` |
| `400` | Validation error or transfer server not allowed | `application/json` | `ApiError` |
| `401` | Bearer authorization token required | `application/json` | `ApiError` |
| `429` | Rate limit exceeded | `application/json` | `ApiError` |
| `502` | Upstream anchor returned an error | `application/json` | `ApiError` |

---

### `POST /api/v1/intent/offramp`

**Summary:** Submit an off-ramp intent (v1)  

The public v1 intent endpoint. Honours `Idempotency-Key`: a retried request replays the original response with `Idempotency-Replayed: true` rather than creating a second intent. Required scope: intents:write.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Intent accepted | `application/json` | `OfframpIntentResponse` |
| `400` | Validation error | `application/json` | `ApiError` |
| `403` | Forbidden: insufficient scope | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `POST /api/v1/intent/onramp`

**Summary:** Submit an on-ramp intent (v1)  

Routes a deposit intent to the best indicative anchor and returns the /onramp handoff URL, plus an unsigned changeTrust XDR when the destination account has no trustline. No anchor session is opened: KYC and the interactive deposit run in the browser. Honours `Idempotency-Key` like the off-ramp endpoint. Required scope: intents:write.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `Idempotency-Key` | `header` | `string` | No | Client-generated key. A repeated value replays the original response. |

#### Request Body

**Content-Type:** `application/json`

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `type` | `"onramp"` | **Yes** | - |
| `sourceAsset` | `string` | **Yes** | Fiat currency paid in, for example NGN |
| `destinationAsset` | `string` | **Yes** | Stellar asset bought, for example USDC |
| `amount` | `string` | **Yes** | Amount of sourceAsset to spend |
| `sender` | `string` | **Yes** | Payer reference on the fiat rail (not a Stellar account) |
| `destination` | `string` | **Yes** | Stellar public key credited when the deposit completes |
| `depositMethod` | `"bank_transfer" | "cash" | "mobile_money" | "card"` | **Yes** | - |
| `memo` | `string` | No | Memo for pooled-account anchors; needs memoType |
| `memoType` | `"text" | "id" | "hash"` | No | - |
| `signature` | `string` | No | Optional attestation; send with publicKey |
| `publicKey` | `string` | No | Signer of the optional attestation |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Route resolved | `application/json` | `OnrampIntentResponse` |
| `400` | Validation error | `application/json` | `ApiError` |
| `401` | Attestation signature did not verify | `application/json` | `ApiError` |
| `403` | Forbidden: insufficient scope | `application/json` | `ApiError` |
| `404` | No anchor serves this corridor | `application/json` | `ApiError` |
| `422` | The destination account does not exist on Stellar | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |
| `503` | No deposit rate is available right now | `application/json` | `ApiError` |

---

## On-ramp

### `GET /api/v1/onramp/quote`

**Summary:** Get indicative deposit (on-ramp) quotes  

Returns an indicative estimate per anchor for depositing a fiat amount into a Stellar asset. SEP-24 publishes deposit fees but the anchor sets the final conversion inside its interactive deposit window, so every figure is an estimate. Required scope: quotes:read.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `corridor` | `query` | `string` | **Yes** | Corridor id, for example usdc-ngn |
| `amount` | `query` | `string` | **Yes** | Fiat amount to deposit: a positive decimal with at most 7 decimal places |
| `asset` | `query` | `string` | No | Restrict rows to one SEP-38 asset (stellar:CODE:ISSUER) |
| `type` | `query` | `"bank_account" | "cash" | "mobile_money"` | No | Funding method (default bank_account) |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Deposit estimates per anchor | `application/json` | `object` |
| `400` | Unknown corridor or invalid amount, asset or type | `application/json` | `ApiError` |
| `429` | Rate limit exceeded | `application/json` | `ApiError` |
| `502` | Anchor rate lookup failed | `application/json` | `ApiError` |

---

## Rates

### `GET /api/deposit-rates/{corridor}`

**Summary:** Get indicative deposit (on-ramp) estimates for a corridor  

Returns per-anchor SEP-24 deposit estimates for the given corridor: fiat in, asset credited net of published fees, with per-anchor failures isolated into `errors`. Every figure is indicative; the anchor sets the firm conversion inside its interactive deposit flow.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `corridor` | `path` | `string` | **Yes** | Corridor ID (e.g. usdc-ngn, usdc-kes) |
| `amount` | `query` | `string` | No | Fiat amount to deposit (positive decimal); defaults to 100 |
| `asset` | `query` | `string` | No | SEP-38 asset identifier to credit; defaults to the corridor's asset |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Deposit estimates for the corridor | `application/json` | `DepositRateComparison` |
| `400` | Unknown corridor or invalid amount | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |
| `502` | The deposit estimate could not be computed | `application/json` | `ApiError` |

---

### `GET /api/rates/{corridor}`

**Summary:** Get live rates for a corridor  

Returns live SEP-38 firm quotes (with SEP-24/SEP-6 fallback) for every integrated anchor serving the given corridor. Results are cached for 15 seconds.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `corridor` | `path` | `string` | **Yes** | Corridor ID (e.g. usdc-ngn, usdc-kes) |
| `amount` | `query` | `string` | No | Amount to convert (positive decimal) |
| `forceRefresh` | `query` | `string` | No | Bypass cache |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Rate comparison for the corridor | `application/json` | `RateComparison` |
| `400` | Unknown corridor or invalid amount | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `GET /api/snapshot`

**Summary:** Get best-anchor snapshot  

Returns the best anchor per corridor for a given USDC amount. Used for the landing page teaser. Cached for 10 minutes.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `amount` | `query` | `string` | No | Amount to convert (positive decimal) |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Best anchor snapshot | `application/json` | `object` |
| `400` | Invalid amount | `application/json` | `ApiError` |

---

### `GET /api/v1/corridors/{corridor}/volume-savings`

**Summary:** Get cumulative volume and fees saved for a corridor  

Reads the on-chain volume/savings oracle for one corridor: cumulative USDC routed, USDC saved against the baseline rate, and the settlement count behind both. Amounts are microUSDC. Served from the contract, so the aggregate is checkable without trusting this app's own database. Zeroes are returned when the corridor has no on-chain entry yet. Required scope: quotes:read.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `corridor` | `path` | `string` | **Yes** | Corridor identifier (e.g. usdc-ngn) |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Cumulative volume and savings | `application/json` | `object` |
| `400` | Invalid corridor ID | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |
| `500` | Oracle read failed | `application/json` | `ApiError` |

---

## Refunds

### `POST /api/refunds/ack`

**Summary:** Record user-signed refund acknowledgement  

Secured write route to record a user-signed refund acknowledgement for an owed or refunded case. The server validates that only the original transfer signer can acknowledge, verifies the cryptographic signature over the canonical payload hash, and confirms the refunded amount does not exceed the paid amount.

#### Request Body

**Content-Type:** `application/json`

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `ack` | `RefundAckPayload` | **Yes** | - |
| `signature` | `string` | **Yes** | Cryptographic signature over the canonical refund-ack payload hash |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Refund acknowledgement recorded | `application/json` | `RefundAckResponse` |
| `400` | Invalid JSON | `application/json` | `ApiError` |
| `401` | Missing or invalid credentials | `application/json` | `ApiError` |
| `403` | Signer mismatch | `application/json` | `ApiError` |
| `404` | No refund case found | `application/json` | `ApiError` |
| `409` | Case already acknowledged | `application/json` | `ApiError` |
| `422` | Validation error | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `GET /api/refunds/{intentHash}`

**Summary:** Look up refund cases for an intent  

Read-only lookup of the refund cases tracked for one intent, oldest first. An intent with no cases returns an empty list, not 404. Only non-sensitive fields are returned; the signer account and the acknowledgement proof are never exposed, and there is no lookup by account. Responses are sent with Cache-Control: no-store.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `intentHash` | `path` | `string` | **Yes** | Lowercase hex SHA-256 intent hash (64 characters) |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Refund cases for the intent | `application/json` | `object` |
| `400` | intentHash is not a lowercase 64-character hex string | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

## Reputation

### `GET /api/reputation/actuarial`

**Summary:** Actuarial progress report  

Progress toward statistically meaningful anchor scoring, combining settled outcomes with probe observations.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Actuarial progress report | `application/json` | `object` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `POST /api/reputation/append`

**Summary:** Append outcome log row  

The single server-side write path for reputation outcome rows. The body must carry the sender's Stellar account (`publicKey`) and an Ed25519 signature by that account over `intentHash` — raw over the 32 hash bytes, or SEP-53 over the hex string (what Freighter `signMessage` produces). `anchorId` must be a registered anchor and `corridor` one it serves. Appends are insert-only: a second POST for a known `intentHash` returns 409 and never changes the stored row. Rate-limited per client IP.

#### Request Body

**Content-Type:** `application/json`

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `intentHash` | `string` | **Yes** | Lowercase hex SHA-256 of the canonical intent |
| `anchorId` | `string` | **Yes** | - |
| `corridor` | `string` | **Yes** | - |
| `quotedRate` | `string` | **Yes** | - |
| `quotedAmount` | `string` | **Yes** | - |
| `outcome` | `"completed" | "partial" | "refunded" | "expired" | "error"` | **Yes** | - |
| `deliveredRate` | `object` | No | - |
| `deliveredAmount` | `object` | No | - |
| `settleSeconds` | `object` | No | - |
| `stellarTransactionId` | `object` | No | - |
| `publicKey` | `string` | **Yes** | The sender account that signed intentHash |
| `signature` | `string` | **Yes** | Base64 Ed25519 signature by publicKey over intentHash |
| `minReceive` | `object` | No | Minimum receive floor amount signed in the outcome intent |
| `outcomeIntent` | `object` | No | The exact outcome intent signed by sender |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `201` | Outcome appended and attested | `application/json` | `object` |
| `400` | Validation error | `application/json` | `ApiError` |
| `401` | Missing signature, or the signature does not verify for publicKey | `application/json` | `ApiError` |
| `409` | An outcome for this intentHash is already recorded | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `GET /api/reputation/dispute`

**Summary:** Look up disputes for an intent  

Retrieves public dispute summaries for a given off-ramp intent hash. Returns newest first. Never includes personal data.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `intentHash` | `query` | `string` | **Yes** | Lowercase hex-encoded SHA-256 intent hash (64 chars) |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | List of disputes for the intent | `application/json` | `object` |
| `422` | Invalid intentHash format | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `POST /api/reputation/dispute`

**Summary:** Submit a reputation dispute  

Submits a dispute against an intent outcome. The request must be Ed25519-signed by the original sender.

#### Request Body

**Content-Type:** `application/json`

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `intentHash` | `string` | **Yes** | - |
| `publicKey` | `string` | **Yes** | - |
| `signature` | `string` | **Yes** | - |
| `anchorId` | `string` | **Yes** | - |
| `reason` | `string` | **Yes** | - |
| `category` | `string` | No | - |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `201` | Dispute created | `application/json` | `DisputeRecord` |
| `400` | Invalid request | `application/json` | `ApiError` |
| `403` | Signature verification failed | `application/json` | `ApiError` |
| `409` | Conflict: open dispute already exists | `application/json` | `ApiError` |
| `422` | Validation error | `application/json` | `ApiError` |
| `429` | Rate limited (10/24h) | `application/json` | `ApiError` |

---

### `POST /api/reputation/dispute/appeal`

**Summary:** Appeal a resolved dispute  

Appeals a resolved dispute (accepted or rejected) within the 14-day window. Must be signed by the original filer.

#### Request Body

**Content-Type:** `application/json`

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `intentHash` | `string` | **Yes** | - |
| `publicKey` | `string` | **Yes** | - |
| `signature` | `string` | **Yes** | - |
| `ref` | `string` | **Yes** | - |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Appeal accepted and dispute reopened at appeal level | `application/json` | `object` |
| `400` | Invalid request body | `application/json` | `ApiError` |
| `403` | Invalid signature or caller is not original filer | `application/json` | `ApiError` |
| `404` | Dispute not found | `application/json` | `ApiError` |
| `409` | Dispute not resolved or already appealed | `application/json` | `ApiError` |
| `410` | Appeal window closed (past 14 days) | `application/json` | `ApiError` |
| `422` | Validation error | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `GET /api/reputation/leaderboard`

**Summary:** Get reputation leaderboard  

Returns a ranked list of all anchors by composite reputation score. Optionally filter by corridor.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `corridor` | `query` | `string` | No | Filter by corridor ID |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Leaderboard response | `application/json` | `LeaderboardResponse` |
| `400` | Validation error | `application/json` | `ApiError` |

---

### `GET /api/reputation/probe-coverage`

**Summary:** Probe coverage report  

How much probe history has accumulated per anchor, and how that compares with the 90-day mainnet-readiness window.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Probe coverage report | `application/json` | `object` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `GET /api/reputation/sdf-export`

**Summary:** Anchor health export for the SDF Anchor Directory  

Anchor health data in the shape SDF’s Anchor Directory consumes.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Export payload | `application/json` | `object` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `GET /api/reputation/{anchor}`

**Summary:** Get anchor reputation  

Returns reputation data for a specific anchor. When a corridor query param is provided, returns per-corridor aggregates for 7/30/90-day windows. Without it, returns scorecards.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `anchor` | `path` | `string` | **Yes** | Anchor ID from the registry |
| `corridor` | `query` | `string` | No | Filter by corridor ID |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Anchor reputation data | `application/json` | `object` |
| `400` | Missing anchor param | `application/json` | `ApiError` |

---

### `GET /api/reputation/{anchor}/history`

**Summary:** Get anchor history  

Returns bucketed outcome history for a specific anchor over a configurable time window.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `anchor` | `path` | `string` | **Yes** | Anchor ID from the registry |
| `window` | `query` | `string` | No | Time window (7d, 30d, 90d) |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Bucketed history data | `application/json` | `object` |
| `400` | Validation error | `application/json` | `ApiError` |
| `404` | Unknown anchor | `application/json` | `ApiError` |

---

### `GET /api/reputation/{anchor}/sla`

**Summary:** Get anchor execution SLA  

Returns trailing 30-day settlement SLA percentiles (nearest-rank, no trimming) for an anchor, requiring at least 30 completed samples (and 100 for p99), evaluated against breach thresholds.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `anchor` | `path` | `string` | **Yes** | Anchor ID from the registry |
| `corridor` | `query` | `string` | No | Filter by corridor ID |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Execution SLA report | `application/json` | `ExecutionSlaReport` |
| `400` | Validation error | `application/json` | `ApiError` |
| `404` | Unknown anchor | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `GET /api/v1/disputes/log`

**Summary:** Get the public dispute adjudication log  

Serves the public, append-only, hash-chained dispute adjudication log, along with verification status and summary counts. Required scope: quotes:read.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `afterSeq` | `query` | `string` | No | Return entries strictly after this sequence number (integer >= 0, default 0) |
| `limit` | `query` | `string` | No | Maximum number of entries to return (1-500, default 200) |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | The adjudication log entries and chain verification | `application/json` | `AdjudicationLogResponse` |
| `400` | Invalid afterSeq or limit parameters | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `GET /api/v1/slippage-breaches`

**Summary:** List slippage breaches  

Returns a list of detected slippage breaches, newest first. Excludes sensitive signerAccount, recipient and raw evidence.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `anchorId` | `query` | `string` | No | Filter by anchor identifier |
| `status` | `query` | `"detected" | "verified" | "rejected"` | No | Filter by breach status |
| `limit` | `query` | `object` | No | Maximum number of breaches to return (1-500, default 100) |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | List of slippage breaches | `application/json` | `object` |
| `400` | Validation error | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |
| `503` | Store unavailable | `application/json` | `ApiError` |

---

### `GET /api/v1/slippage-breaches/{intentHash}`

**Summary:** Get slippage breach detail  

Returns detailed information about a slippage breach, including full evidence and canonical evidence JSON string for independent SHA-256 verification.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `intentHash` | `path` | `string` | **Yes** | 64-character lowercase hex SHA-256 intent hash |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Slippage breach detail with evidence | `application/json` | `object` |
| `400` | Invalid intentHash format | `application/json` | `ApiError` |
| `404` | Breach not found | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |
| `503` | Store unavailable | `application/json` | `ApiError` |

---

### `GET /api/v1/slippage-compliance`

**Summary:** Get slippage compliance metrics  

Returns slippage compliance metrics and release gate status for the specified rolling window (30, 90 days, or all).

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `window` | `query` | `"30" | "90" | "all"` | No | Evaluation window: 30, 90, or all (default 30) |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Slippage compliance metrics and release gate status | `application/json` | `SlippageCompliance` |
| `400` | Validation error | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |
| `503` | Store unavailable | `application/json` | `ApiError` |

---

### `GET /v1/public/scores`

**Summary:** Get public scores  

Returns public 30-day corridor reputation scores. Supports conditional GET with ETags.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Public scores array | `application/json` | `object[]` |
| `304` | Not modified | - | - |
| `429` | Rate limited | `application/json` | `ApiError` |

---

## SEP-10

### `POST /api/sep10/client-domain`

**Summary:** Co-sign a SEP-10 client_domain challenge  

Adds the server-held `client_domain` signature to a verified SEP-10 challenge so an anchor can attribute the session to us. The challenge is re-validated in full against the anchor’s published SIGNING_KEY (mainnet, sequence 0, anchor-signed, manage_data only, timebounds ≤ 24h) and must carry exactly one `client_domain` operation naming our domain and sourced by our signing key. This route is not a general-purpose signing oracle.

#### Request Body

**Content-Type:** `application/json`

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `transaction` | `string` | **Yes** | Base64 SEP-10 challenge XDR from the anchor |
| `homeDomain` | `string` | **Yes** | Home or service domain of a registered anchor the challenge is from |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Challenge co-signed | `application/json` | `object` |
| `400` | Invalid request, unregistered anchor, or challenge failed validation | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |
| `503` | Server client_domain signing is not configured | `application/json` | `ApiError` |

---

## SEP-6

### `POST /api/sep6/withdraw`

**Summary:** SEP-6 withdraw proxy  

Proxies a SEP-6 withdrawal request to the specified anchor transfer server. Runs server-side to avoid CORS issues.

#### Request Body

**Content-Type:** `application/json`

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `transferServer` | `string` | **Yes** | - |
| `assetCode` | `string` | **Yes** | - |
| `account` | `string` | **Yes** | - |
| `amount` | `string` | No | - |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Anchor withdraw response (passthrough) | `application/json` | `object` |
| `400` | Validation error | `application/json` | `ApiError` |

---

## System

### `POST /api/admin/cache/invalidate`

**Summary:** Invalidate cached rates  

Drops cached rate comparisons for one anchor or all of them. Admin only.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Cache invalidated | `application/json` | `object` |
| `401` | Missing or invalid credentials | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `POST /api/graphql`

**Summary:** GraphQL endpoint  

Additive GraphQL surface over the same data the REST API serves (see docs/GRAPHQL_API.md). REST remains the source of truth documented here; the GraphQL schema is published separately.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | GraphQL result envelope | `application/json` | `object` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `POST /api/mcp`

**Summary:** MCP server (Streamable HTTP)  

Model Context Protocol server over the Streamable HTTP transport, so an MCP client can reach the off-ramp tools with a URL and nothing installed. Stateless: every request carries its own context and no Mcp-Session-Id is issued. The body is JSON-RPC 2.0, and Accept must include both application/json and text/event-stream. GET and DELETE return 405 — this server never initiates messages, so there is no stream to open and no session to delete. See docs/MCP.md for the tool list and client configuration.

#### Request Body

A JSON-RPC 2.0 request, e.g. an initialize handshake or tools/list.

**Content-Type:** `application/json`

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `jsonrpc` | `"2.0"` | **Yes** | - |
| `id` | `object` | No | - |
| `method` | `string` | **Yes** | - |
| `params` | `object` | No | - |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | JSON-RPC result | `application/json` | `object` |
| `406` | Accept header does not include text/event-stream | - | - |
| `415` | Content-Type is not application/json | - | - |
| `429` | Rate limit exceeded | - | - |

---

### `GET /api/mcp/ping`

**Summary:** MCP health check  

Simple health check / liveness probe for the MCP integration.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | OK | `application/json` | `object` |

---

### `GET /api/metrics`

**Summary:** Get metrics snapshot  

Returns the in-process metrics snapshot including intent counters, anchor latency, and publisher health.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Metrics snapshot | `application/json` | `MetricsSnapshot` |

---

### `GET /api/publisher/health`

**Summary:** Get publisher health  

Returns the current publisher health status including last run time, batch size, and staleness.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Publisher health status | `application/json` | `PublisherHealth` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `GET /api/publisher/tick`

**Summary:** Trigger publisher tick  

Triggers a batch of reputation outcome submissions to the Soroban oracle contract. Protected by CRON_SECRET. A mainnet tick is gated on 90 days of continuous probe coverage (#786); when the gate blocks, this still returns 200 with `submitted: 0` and a `gate` object explaining the refusal, because a withheld batch is the gate working rather than an incident.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Tick completed, or withheld by the publish gate | `application/json` | `object` |
| `401` | Unauthorized | `application/json` | `ApiError` |
| `409` | Tick already in progress | `application/json` | `ApiError` |

---

### `POST /api/reputation/dispute-sweep`

**Summary:** Escalate overdue disputes  

Cron-triggered. Moves every open dispute that sat at the anchor response rung past its 72-hour deadline to maintainer review and records the move in the public adjudication log. Disputes already at review or appeal are left for a human to decide. Protected by CRON_SECRET.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Sweep completed | `application/json` | `object` |
| `401` | Missing or invalid credentials | `application/json` | `ApiError` |

---

### `GET /api/reputation/reconcile`

**Summary:** Reconcile settled outcomes against Horizon  

Cron-triggered reconciliation of pending outcome rows. Protected by CRON_SECRET.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Reconciliation completed | `application/json` | `object` |
| `401` | Missing or invalid credentials | `application/json` | `ApiError` |

---

### `GET /api/reputation/reconcile-volume-savings`

**Summary:** Reconcile volume and savings against the on-chain oracle  

Cron-triggered. Re-derives per-corridor volume and savings from the outcome log and compares them against the on-chain totals, reporting any discrepancy rather than silently diverging. Protected by CRON_SECRET.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Reconciliation completed | `application/json` | `object` |
| `401` | Missing or invalid credentials | `application/json` | `ApiError` |
| `500` | Reconciliation failed | `application/json` | `ApiError` |

---

### `POST /api/reputation/refresh`

**Summary:** Run the probe sweep  

Cron-triggered. Probes every registered anchor across all four dimensions and persists the samples. Returns 500 when a sweep probes anchors but persists nothing. Protected by CRON_SECRET.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Sweep completed | `application/json` | `object` |
| `401` | Missing or invalid credentials | `application/json` | `ApiError` |
| `409` | A refresh is already in progress | - | - |
| `500` | Sweep persisted no samples | `application/json` | `ApiError` |

---

### `GET /api/status`

**Summary:** API version and deprecation status  

Current API version, the supported version window, and any announced deprecations — the "Status page" announcement channel in docs/VERSIONING.md.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Status snapshot | `application/json` | `object` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `GET /api/v1/health`

**Summary:** Service health (v1)  

Liveness and dependency status for the public v1 surface. Required scope: quotes:read.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Health snapshot | `application/json` | `object` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `GET /api/v1/usage`

**Summary:** Caller usage (v1)  

The caller's own tier, scopes, daily quota and current per-minute windows, read without spending quota on the counted buckets. Any caller may read its own usage.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Usage snapshot | `application/json` | `object` |
| `401` | Missing or invalid credentials | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `GET /api/webhooks/deliveries`

**Summary:** List webhook delivery records  

Admin only. Returns webhook delivery records filtered by status, subscription, or event, newest first.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `status` | `query` | `"success" | "failed" | "dead_letter"` | No | Filter by delivery status (success, failed, dead_letter) |
| `subscriptionId` | `query` | `string` | No | Filter by subscription ID |
| `eventId` | `query` | `string` | No | Filter by event ID |
| `limit` | `query` | `integer` | No | Maximum number of deliveries to return (1-500, default 100) |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Webhook delivery records | `application/json` | `object[]` |
| `400` | Validation error | `application/json` | `ApiError` |
| `401` | Missing or invalid credentials | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `POST /api/webhooks/deliveries/{id}/redeliver`

**Summary:** Resend a logged webhook delivery  

Admin only. Sends the stored event of one logged delivery to its subscription again, with the original event `id` and idempotency key, so a consumer that already processed it de-duplicates. The attempt is logged as a new delivery record. A 202 means the attempt was made, not that the subscriber accepted it. See docs/WEBHOOKS.md.

#### Parameters

| Name | In | Type | Required | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `path` | `string` | **Yes** | Delivery record id, as listed by GET /api/webhooks/deliveries |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `202` | The delivery was attempted again and logged | `application/json` | `object` |
| `403` | Missing or invalid admin key | `application/json` | `ApiError` |
| `404` | Unknown delivery id (`NOT_FOUND`) | `application/json` | `ApiError` |
| `409` | The subscription no longer subscribes to the event kind (`EVENT_KIND_UNSUBSCRIBED`) | `application/json` | `ApiError` |
| `410` | The event is not in the event store (`EVENT_NOT_RETAINED`), or the subscription was deleted (`SUBSCRIPTION_DELETED`) | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `GET /api/webhooks/failures`

**Summary:** List dead-lettered webhook deliveries  

Admin only. Deliveries that exhausted their retries and were dead-lettered (see docs/WEBHOOKS.md).

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Dead-lettered deliveries | `application/json` | `object[]` |
| `401` | Missing or invalid credentials | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `GET /api/webhooks/subscriptions`

**Summary:** List webhook subscriptions  

Admin only. See docs/WEBHOOKS.md for the delivery and signing contract.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Subscriptions | `application/json` | `object[]` |
| `401` | Missing or invalid credentials | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `POST /api/webhooks/subscriptions`

**Summary:** Create a webhook subscription  

Admin only. Returns the per-subscription HMAC signing secret once, at creation time.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `201` | Subscription created | `application/json` | `object` |
| `400` | Validation error | `application/json` | `ApiError` |
| `401` | Missing or invalid credentials | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

### `DELETE /api/webhooks/subscriptions/{id}`

**Summary:** Delete a webhook subscription  

Admin only.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `204` | Deleted | - | - |
| `401` | Missing or invalid credentials | `application/json` | `ApiError` |
| `404` | Unknown subscription | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---
