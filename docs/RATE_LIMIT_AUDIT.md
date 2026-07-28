# Rate-Limit Coverage Audit

Audit step for `#732`. `docs/ROADMAP.md` and `docs/THREAT_MODEL.md` note rate
limiting as "partially present" — this document enumerates every route under
`app/api/*`, records whether request-rate middleware is actually applied, and
flags gaps for the follow-up fix issue (`#D047`).

There is no global `middleware.ts` in this repo, so coverage is necessarily
per-route: each handler either calls `checkRateLimit()` from
[`lib/api/rate-limit.ts`](../lib/api/rate-limit.ts) (or implements an
equivalent throttle itself), or it has none.

## Legend

- ✅ **Covered** — calls `checkRateLimit()` or an equivalent per-caller throttle.
- ⚠️ **Partial** — gated by a bearer secret and/or a run-lock, but not by a
  per-caller request-rate limit (a valid-secret holder can still call it as
  fast as the network allows).
- ❌ **Gap** — no rate limiting and no other request-throttling control.

## Coverage table

| Route                                 | Method(s)               | Write / expensive?                                                | Status                           | Notes                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ----------------------- | ----------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/api/admin/disputes`              | GET, POST               | Write (resolve dispute)                                           | ❌ Gap                           | Gated by `ADMIN_SECRET_KEY` (`isAdminRequest`, timing-safe compare), but no rate limit behind that gate.                                                                                                                                                                         |
| `app/api/intent/offramp`              | POST                    | Write-adjacent (builds unsigned Stellar tx)                       | ❌ Gap                           | Public, unauthenticated, no rate limit.                                                                                                                                                                                                                                          |
| `app/api/mcp/ping`                    | GET                     | No                                                                | ❌ Gap                           | Trivial handler; low risk but unmetered.                                                                                                                                                                                                                                         |
| `app/api/metrics`                     | GET, POST               | Write (POST ingests client samples)                               | ❌ Gap                           | POST accepts arbitrary-frequency client samples with no throttle.                                                                                                                                                                                                                |
| `app/api/publisher/health`            | GET                     | No                                                                | ❌ Gap                           | Read-only status; low risk but unmetered.                                                                                                                                                                                                                                        |
| `app/api/publisher/tick`              | GET, POST               | Write + expensive (submits batch to oracle contract)              | ⚠️ Partial                       | Requires `CRON_SECRET` bearer auth and a run-lock (`acquireLock`/`releaseLock`) that serializes concurrent ticks, but neither is a per-caller rate limit.                                                                                                                        |
| `app/api/rates/[corridor]`            | GET                     | Expensive (live per-anchor `stellar.toml` + `/price` fan-out)     | ❌ Gap                           | **Doc/code mismatch:** `docs/THREAT_MODEL.md` lists this route as protected by `lib/api/rate-limit.ts`, but the handler never calls `checkRateLimit()`. Highest-priority gap — public, unauthenticated, and does outbound network fan-out per request.                           |
| `app/api/reputation/append`           | POST                    | Write (outcome-log row)                                           | ❌ Gap                           | Single server-side write path per its own comment, but has no rate limit.                                                                                                                                                                                                        |
| `app/api/reputation/dispute`          | POST                    | Write                                                             | ✅ Covered                       | Implements its own per-`publicKey` limiter (`checkDisputeRateLimit`, 10 requests / 24h) inline rather than using `lib/api/rate-limit.ts`. Functionally covered; flagged only for consolidation.                                                                                  |
| `app/api/reputation/leaderboard`      | GET                     | Expensive (per-anchor store query + on-chain oracle read fan-out) | ❌ Gap                           | Public, unauthenticated aggregation across all anchors; no rate limit.                                                                                                                                                                                                           |
| `app/api/reputation/reconcile`        | GET, POST               | Write + expensive (Horizon lookups, backfills store)              | ⚠️ Partial                       | Requires `CRON_SECRET` bearer auth; no per-caller rate limit behind it.                                                                                                                                                                                                          |
| `app/api/reputation/refresh`          | GET, POST               | POST is write (triggers refresh + lock)                           | ⚠️ Partial (POST) / ❌ Gap (GET) | POST requires `CRON_SECRET` + run-lock; GET (status read) is fully public and unmetered.                                                                                                                                                                                         |
| `app/api/reputation/[anchor]/history` | GET                     | Read (bucket aggregation)                                         | ❌ Gap                           | No rate limit. Also the one route in this set not wrapped in `withRequestLogger`, inconsistent with the rest of `app/api`.                                                                                                                                                       |
| `app/api/reputation/[anchor]`         | GET                     | Read (aggregation, optional on-chain read)                        | ❌ Gap                           | No rate limit.                                                                                                                                                                                                                                                                   |
| `app/api/sep6/withdraw`               | POST, GET (`/customer`) | Write-adjacent, proxies to third-party anchor over the network    | ❌ Gap                           | No auth, no rate limit, and it's an open server-side proxy to any `https://` `transferServer` the caller supplies — the highest-risk gap alongside `rates/[corridor]`, since it can be used to drive arbitrary request volume at third-party anchor domains through this server. |
| `app/api/snapshot`                    | GET                     | Read, but cached                                                  | ❌ Gap                           | `revalidate = 600` plus in-process memoization bounds most load, but there is no explicit rate limit for the cache-miss path. Lowest priority of the gaps.                                                                                                                       |

## Summary

- **1 of 16** routes has functioning per-caller rate-limit coverage
  (`reputation/dispute`, via a bespoke limiter).
- **3 of 16** routes (`publisher/tick`, `reputation/reconcile`,
  `reputation/refresh` POST) are shielded by a bearer secret and/or a run-lock,
  which is not equivalent to a rate limit but does restrict who can call them
  and how concurrently.
- **12 of 16** routes have no request-throttling control of any kind.
- `lib/api/rate-limit.ts` (`checkRateLimit`) exists and is exercised today
  only by `app/v1/public/scores` (outside `app/api`, not in scope here) — it
  is not wired into any `app/api/*` route despite `docs/THREAT_MODEL.md`
  claiming coverage for `app/api/rates`.

## Flagged for `#D047` (write / expensive routes, priority order)

1. `app/api/sep6/withdraw` (POST) — unauthenticated proxy to arbitrary anchor domains.
2. `app/api/rates/[corridor]` (GET) — unauthenticated, live outbound fan-out; contradicts existing threat-model documentation.
3. `app/api/reputation/leaderboard` (GET) — unauthenticated, per-anchor aggregation + on-chain reads.
4. `app/api/admin/disputes` (POST) — authenticated but unthrottled write.
5. `app/api/reputation/append` (POST) — sole write path for outcome rows, unthrottled.
6. `app/api/intent/offramp` (POST) — unauthenticated transaction-building endpoint.
7. `app/api/metrics` (POST) — unauthenticated, unbounded client-sample ingestion.

Routes gated by `CRON_SECRET` (`publisher/tick`, `reputation/reconcile`,
`reputation/refresh`) and the low-risk read-only routes (`mcp/ping`,
`publisher/health`, `reputation/[anchor]`, `reputation/[anchor]/history`,
`snapshot`) are lower priority but still listed above as gaps per the
acceptance criteria's "complete coverage table" requirement.
