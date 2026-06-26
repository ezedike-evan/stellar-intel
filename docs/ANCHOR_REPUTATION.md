# Anchor Reputation

Every quote, fill, failure, and settlement latency an anchor produces is recorded
as an **outcome**. Outcomes aggregate into a public, user-verifiable score. The
goal is carrot, not stick: an anchor earns a track record it can point to.

Source of truth: [`lib/reputation/`](../lib/reputation/),
[`types/reputation.ts`](../types/reputation.ts), the
`/api/reputation/*` routes, and the Soroban contract in
[`contracts/reputation/`](../contracts/reputation/) (see
[`docs/ORACLE_SPEC.md`](ORACLE_SPEC.md)).

## Composite score

Defined in [`lib/reputation/composite.ts`](../lib/reputation/composite.ts):

```
score = fillRate × (1 − slippage) ÷ (settleSeconds / NORM_SETTLE_SECONDS)
```

- `fillRate` — fraction of quotes that settled, `[0, 1]`.
- `slippage` — fractional gap between quoted and delivered value, `[0, 1]`.
- `settleSeconds` — median settlement time; floored at `MIN_SETTLE_SECONDS` (1).
- `NORM_SETTLE_SECONDS = 300` — the "baseline fast" reference.

A score of **1.0** = perfect fill, zero slippage, settled at exactly the 300 s
reference. **> 1.0** = faster than reference. Higher is better.

## Score bands

[`lib/reputation/bands.ts`](../lib/reputation/bands.ts) maps a raw score to a band
via `SCORE_THRESHOLDS` (`getScoreBand` / `getBandLabel`) so the UI can render
confidence labels rather than raw floats.

## Storage

The reputation store is pluggable (`lib/reputation/store.ts`):

- **Dev** — SQLite ([`lib/reputation/sqlite.ts`](../lib/reputation/sqlite.ts)).
- **Prod** — Postgres ([`lib/reputation/postgres.ts`](../lib/reputation/postgres.ts)).

Aggregation, bucketing, reconciliation, locking, and PII redaction live alongside
(`aggregate.ts`, `buckets.ts`, `reconcile.ts`, `lock.ts`, `redact.ts`). Migrations
are in `lib/reputation/migrations/`.

## API

| Method & path                                   | Purpose                                   |
| ----------------------------------------------- | ----------------------------------------- |
| `GET /api/reputation/leaderboard?corridor=…`    | Ranked anchors (optionally per-corridor). |
| `GET /api/reputation/[anchor]`                  | Current score + bands for one anchor.     |
| `GET /api/reputation/[anchor]/history?window=…` | Historical score series.                  |
| `POST /api/reputation/append`                   | Append a signed outcome tuple.            |
| `POST /api/reputation/dispute`                  | File a dispute against an outcome.        |
| `POST /api/reputation/reconcile`                | Reconcile aggregates (maintenance).       |
| `POST /api/reputation/refresh`                  | Refresh materialized aggregates.          |

Outcomes are signed and replayable, so a dispute resolves on evidence, not
opinion. Admin-only review is gated by `ADMIN_SECRET_KEY` via
`/api/admin/disputes`.

## On-chain mirror

The same outcomes are written to the Soroban reputation contract for permissionless
reads. The contract interface (`submit_outcome`, anchor registry, admin) is
specified in [`docs/ORACLE_SPEC.md`](ORACLE_SPEC.md). Mainnet deployment is a
roadmap gate (see [`docs/ROADMAP.md`](ROADMAP.md), Wave 2.1).

## Disputes

Terminal-state rows expose a "flag incorrect outcome" path. A dispute records the
contesting party and the disputed outcome id; because every outcome carries the
user's signature and is replayable from the ledger, adjudication is evidence-based.

---

## New Anchor Reputation: Bootstrap to Live

When an anchor is first onboarded to the fleet, it has no transaction history. This
section explains how the reputation system handles this cold-start period.

Source of truth:
[`lib/reputation/thresholds.ts`](../lib/reputation/thresholds.ts),
[`lib/reputation/aggregate.ts`](../lib/reputation/aggregate.ts),
[`lib/reputation/bands.ts`](../lib/reputation/bands.ts), and the
[`ScorecardCard`](../components/offramp/ScorecardCard.tsx) component.

### Bootstrap Phase

On onboarding, a new anchor has **no composite score** — the system does not
assign a synthetic seed value. Instead, the scorecard enters an
`insufficient_data` state, and the UI displays a **"Collecting Data"** notice
that tells consumers the anchor is still being evaluated.

During bootstrap:

- `compositeScore` is `null` — no score is computed or displayed
- The scorecard `state` field is `"insufficient_data"` (see
  [`Scorecard` type](../lib/reputation/aggregate.ts))
- Score bands (green / amber / red) are not assigned
- The UI shows the number of remaining outcomes needed and an estimated time
  to reach the threshold
  ([`ScorecardCard`](../components/offramp/ScorecardCard.tsx))

**Example bootstrap API response** (`GET /api/reputation/[anchor]`):

| Field          | Value                  |
| -------------- | ---------------------- |
| `state`        | `"insufficient_data"`  |
| `sampleSize`   | `0`                    |
| `compositeScore` | `null`               |
| `scoreBand`    | _(not assigned)_       |

### Accruing Reputation

As the anchor processes transactions, each terminal outcome (completed,
partial, refunded, expired, or error) is appended to the outcome log
([`types/reputation.ts`](../types/reputation.ts)). Rolling scorecards
aggregate these outcomes over 7-, 30-, and 90-day windows.

The composite score formula
([`lib/reputation/composite.ts`](../lib/reputation/composite.ts)) weights
three factors equally per transaction — fill rate, slippage, and settlement
speed — so all transactions within a window contribute with equal weight.
<!-- TODO: verify equal weighting vs recency bias with maintainer — the
     current implementation in aggregate.ts uses a flat window with no
     exponential decay -->

**Progression toward live status:**

| Outcomes | Scorecard `state`    | Score Band | Phase     |
| -------- | -------------------- | ---------- | --------- |
| 0        | `insufficient_data`  | _(none)_   | bootstrap |
| 1–29     | `insufficient_data`  | _(none)_   | bootstrap |
| 30+      | `ok`                 | green / amber / red | live |

The threshold of **30 outcomes** is defined by `MIN_OUTCOMES_THRESHOLD` in
[`lib/reputation/thresholds.ts`](../lib/reputation/thresholds.ts) and can be
overridden with the `NEXT_PUBLIC_MIN_OUTCOMES` environment variable.

### Live Status

An anchor graduates to **live** status when it has accumulated at least
**`MIN_OUTCOMES_THRESHOLD`** (default **30**) terminal outcomes within the
scorecard window. At that point:

- The scorecard `state` becomes `"ok"` and exposes full metrics: `fillRate`,
  `settleMs` (p50 / p95), and `slippage` (p50 / p95)
- A composite score is computed and mapped to a
  [score band](../lib/reputation/bands.ts):

  | Band   | Score range | Label             |
  | ------ | ----------- | ----------------- |
  | green  | ≥ 95        | Excellent         |
  | amber  | 80 – 94     | Needs Improvement |
  | red    | < 80        | Critical          |

- The reputation score is fully evidence-based and trusted by downstream
  consumers for routing and risk decisions

### What Consumers Should Do During Bootstrap

If your integration reads anchor reputation scores, inspect the scorecard
`state` field before acting on the score:

- **`"insufficient_data"`** — the anchor is still in bootstrap. Treat it as
  unscored; apply wider risk tolerances or defer high-value routing decisions
  until enough outcomes have been recorded.
- **`"ok"`** — the anchor has a live, evidence-based score. Use the
  `compositeScore` and score band with standard confidence.

You can also call
[`hasEnoughData(outcomesCount)`](../lib/reputation/thresholds.ts) and
[`estimateTimeToThreshold(outcomesCount)`](../lib/reputation/thresholds.ts)
to programmatically check readiness and display a progress indicator in your
UI, as the built-in
[`ScorecardCard`](../components/offramp/ScorecardCard.tsx) does.
