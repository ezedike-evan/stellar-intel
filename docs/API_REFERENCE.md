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
  - [`GET /api/admin/disputes`](#get-apiadmindisputes)
  - [`POST /api/admin/disputes`](#post-apiadmindisputes)
- **Anchors**
  - [`GET /api/v1/anchor-health/ledger`](#get-apiv1anchor-healthledger)
  - [`GET /api/v1/anchors/{id}/health`](#get-apiv1anchorsidhealth)
- **Intent**
  - [`POST /api/intent`](#post-apiintent)
  - [`POST /api/intent/offramp`](#post-apiintentofframp)
  - [`POST /api/v1/intent/offramp`](#post-apiv1intentofframp)
- **Rates**
  - [`GET /api/rates/{corridor}`](#get-apiratescorridor)
  - [`GET /api/snapshot`](#get-apisnapshot)
  - [`GET /api/v1/corridors/{corridor}/volume-savings`](#get-apiv1corridorscorridorvolume-savings)
- **Reputation**
  - [`GET /api/reputation/actuarial`](#get-apireputationactuarial)
  - [`POST /api/reputation/append`](#post-apireputationappend)
  - [`POST /api/reputation/dispute`](#post-apireputationdispute)
  - [`GET /api/reputation/leaderboard`](#get-apireputationleaderboard)
  - [`GET /api/reputation/probe-coverage`](#get-apireputationprobe-coverage)
  - [`GET /api/reputation/sdf-export`](#get-apireputationsdf-export)
  - [`GET /api/reputation/{anchor}`](#get-apireputationanchor)
  - [`GET /api/reputation/{anchor}/history`](#get-apireputationanchorhistory)
  - [`GET /v1/public/scores`](#get-v1publicscores)
- **SEP-6**
  - [`POST /api/sep6/withdraw`](#post-apisep6withdraw)
- **System**
  - [`POST /api/admin/cache/invalidate`](#post-apiadmincacheinvalidate)
  - [`POST /api/graphql`](#post-apigraphql)
  - [`GET /api/mcp/ping`](#get-apimcpping)
  - [`GET /api/metrics`](#get-apimetrics)
  - [`GET /api/publisher/health`](#get-apipublisherhealth)
  - [`GET /api/publisher/tick`](#get-apipublishertick)
  - [`GET /api/reputation/reconcile`](#get-apireputationreconcile)
  - [`GET /api/reputation/reconcile-volume-savings`](#get-apireputationreconcile-volume-savings)
  - [`POST /api/reputation/refresh`](#post-apireputationrefresh)
  - [`GET /api/status`](#get-apistatus)
  - [`GET /api/v1/health`](#get-apiv1health)
  - [`GET /api/webhooks/failures`](#get-apiwebhooksfailures)
  - [`GET /api/webhooks/subscriptions`](#get-apiwebhookssubscriptions)
  - [`POST /api/webhooks/subscriptions`](#post-apiwebhookssubscriptions)
  - [`DELETE /api/webhooks/subscriptions/{id}`](#delete-apiwebhookssubscriptionsid)

## Admin

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
| `action` | `"accept" | "reject"` | **Yes** | - |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Updated dispute | `application/json` | `DisputeAdmin` |
| `400` | Invalid request | `application/json` | `ApiError` |
| `401` | Admin access required | `application/json` | `ApiError` |
| `404` | Dispute not found | `application/json` | `ApiError` |

---

## Anchors

### `GET /api/v1/anchor-health/ledger`

**Summary:** Get the anchor health ledger for a date  

Publishes the nightly anchor health ledger as a dated artifact. Without `date`, returns the ledger this deployment was built with. With `date` (YYYY-MM-DD), returns the ledger as it stood on that date, resolved from the git history of `constants/anchor-health.json` — so the series is fetchable without cloning the repository. The committed file remains the source of truth; nothing is mirrored server-side. A dated response is immutable and cached as such.

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

### `GET /api/v1/anchors/{id}/health`

**Summary:** Get anchor health status  

Returns the anchor's current health status, last-probe timestamp, and score breakdown. Returns 'unknown' or 'stale' when probes haven't run recently — honest degradation rather than fabricated data.

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

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `201` | Route resolved and unsigned transaction built | `application/json` | `OfframpIntentResponse` |
| `400` | Validation error or no route found | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |
| `500` | Transaction build failure | `application/json` | `ApiError` |

---

### `POST /api/v1/intent/offramp`

**Summary:** Submit an off-ramp intent (v1)  

The public v1 intent endpoint. Honours `Idempotency-Key`: a retried request replays the original response with `Idempotency-Replayed: true` rather than creating a second intent.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Intent accepted | `application/json` | `OfframpIntentResponse` |
| `400` | Validation error | `application/json` | `ApiError` |
| `429` | Rate limited | `application/json` | `ApiError` |

---

## Rates

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

Reads the on-chain volume/savings oracle for one corridor: cumulative USDC routed, USDC saved against the baseline rate, and the settlement count behind both. Amounts are microUSDC. Served from the contract, so the aggregate is checkable without trusting this app's own database. Zeroes are returned when the corridor has no on-chain entry yet.

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

The single server-side write path for reputation outcome rows.

#### Request Body

**Content-Type:** `application/json`

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `intentHash` | `string` | **Yes** | - |
| `anchorId` | `string` | **Yes** | - |
| `corridor` | `string` | **Yes** | - |
| `outcome` | `"completed" | "partial" | "refunded" | "expired" | "error"` | **Yes** | - |

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `201` | Outcome appended | `application/json` | `object` |
| `400` | Validation error | `application/json` | `ApiError` |

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

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `201` | Dispute created | `application/json` | `DisputeRecord` |
| `400` | Invalid request | `application/json` | `ApiError` |
| `403` | Signature verification failed | `application/json` | `ApiError` |
| `422` | Validation error | `application/json` | `ApiError` |
| `429` | Rate limited (10/24h) | `application/json` | `ApiError` |

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

Liveness and dependency status for the public v1 surface.

#### Responses

| Status | Description | Content-Type | Schema |
| :--- | :--- | :--- | :--- |
| `200` | Health snapshot | `application/json` | `object` |
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
