# Anchor Reputation

**Last reviewed:** 2026-08-26

Every quote, fill, failure, and settlement latency an anchor produces is recorded
as an **outcome**. Outcomes aggregate into a public, user-verifiable score. The
goal is carrot, not stick: an anchor earns a track record it can point to.

Source of truth: [`lib/reputation/`](../lib/reputation/),
[`types/reputation.ts`](../types/reputation.ts), the
`/api/reputation/*` routes, and the Soroban contract in
[`contracts/reputation/`](../contracts/reputation/) (see
[`docs/ORACLE_SPEC.md`](ORACLE_SPEC.md)).

## Two records, never added together

This project keeps two separate records about an anchor, and the difference
between them is the difference between what we watched and what a user lived
through.

|          | **Health**                                               | **Reputation**                       |
| -------- | -------------------------------------------------------- | ------------------------------------ |
| Measures | What we observed by probing                              | What happened when someone settled   |
| Signals  | uptime, quote availability, issuer match, TOML integrity | fill rate, settlement time, slippage |
| Source   | `probe_samples`, written every five minutes              | `outcome_log`, written on settlement |
| Needs    | nothing from the anchor or the user                      | real completed transactions          |
| Method   | `lib/reputation/health.ts`                               | `lib/reputation/composite.ts`        |

Health **never contributes to the composite score**. An anchor can be perfectly
healthy and still carry no reputation score at all, and that is the honest
reading: it has not performed badly, it has not been observed performing.

Both are published. Anything that reports one is labelled with which one it is —
the leaderboard response carries an explicit
`basis: { reputation: 'execution-outcomes', health: 'probe-observations' }`.

## Probe-derived health

Defined in [`lib/reputation/health.ts`](../lib/reputation/health.ts). Every
registered anchor is probed on a five-minute clock across four signals, each
stored as a `ProbeKind` row in `probe_samples`, keyed by the anchor's probe
domain (`serviceDomain ?? homeDomain`):

| Signal             | `ProbeKind`       | What it checks                                                     |
| ------------------ | ----------------- | ------------------------------------------------------------------ |
| Uptime             | `uptime`          | The anchor's `stellar.toml` resolves and is reachable.             |
| Quote availability | `quote`           | A SEP-38 quote round-trip returns a quote.                         |
| Issuer match       | `issuer-mismatch` | The issuer the anchor advertises still matches the asset on-chain. |
| TOML integrity     | `toml-integrity`  | The `stellar.toml` still parses and validates.                     |

The health score is a weighted mean over the signals that were **actually
sampled**, with the weights renormalised across exactly those:

```
healthScore = Σ wᵢ · successRateᵢ ÷ Σ wᵢ      (over signals with samples > 0)

HEALTH_WEIGHTS = { uptime: 0.4, quoteAvailability: 0.2,
                   issuerMatch: 0.2, tomlIntegrity: 0.2 }
```

Uptime carries the most weight because it is the signal a user feels first: an
anchor that does not answer cannot be used at any price.

### A check that could not complete is not a failure by the anchor

For the two comparison signals — issuer match and TOML integrity — a probe row
counts only if it either succeeded or produced that signal's own verdict:
`mismatch` for the issuer check, `integrity` for the TOML check. A row that
failed for any other reason means the check never reached a verdict, and it is
excluded from the signal's counts entirely and reported separately as
`incomplete`.

This is not a technicality. MoneyGram's issuer check has 583 rows in the ledger,
zero successes, and has never once returned `mismatch` — every failure is
`unknown`, meaning the check did not complete. Counting those as failures would
publish "issuer match: 0%" about a real company on a public page, which is an
accusation the data does not support. The probe layer already draws this
distinction; `probeIssuerMismatch` documents that an unreachable result "covers
both a genuine mismatch … and a probe that could not complete".

Uptime and quote availability are liveness observations rather than comparisons,
so every failure counts for those two: a request that did not come back is the
answer, whatever the transport reason.

Two further rules follow from the renormalisation, and both are deliberate:

- **A signal that was never sampled scores nothing, not zero.** If the quote
  sweep has not run for an anchor, that anchor has not failed quote
  availability — the question was not asked. Its `successRate` is `null`, and
  the UI prints `not sampled` rather than `0%`.
- **Below `MIN_HEALTH_SAMPLES` (12, roughly one hour of probing) no score is
  published.** The signals are still reported, because they are observations
  and they are true; the state is `insufficient_data` and `healthScore` is
  `null`.

`observedDays` and `continuousDays` come from the same
`buildProbeCoverageReport` that backs `GET /api/reputation/probe-coverage`, so
the two surfaces cannot disagree. A streak whose last observation is older than
yesterday is reported as `0` — an anchor last probed a week ago is not on a
seven-day run.

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

### Two known divergences between this document and the code

Stated here rather than left for a reader to discover, because a published
method that does not match the running code is worse than no published method.

1. **The leaderboard does not rank on the formula above.** `composite()` is the
   formula published here and written on-chain. The corridor leaderboard, the
   standings page and `lib/reputation/scores.ts` all rank on
   `weightedComposite()` instead — a clamped `0.4 × fill + 0.3 × (1 −
slippage/0.05) + 0.3 × (1 − settle/300)` bounded to `[0, 1]`. The two produce
   different orderings. `lib/reputation/composite.ts` acknowledges the split in
   its own comments; picking one is tracked in #917.
2. **`state` flips at one outcome, not thirty.** `MIN_SAMPLES = 1` in
   `lib/reputation/aggregate.ts` is what moves a scorecard from
   `insufficient_data` to `ok`. `MIN_OUTCOMES_THRESHOLD = 30` is a _display_
   threshold only — it gates the "Collecting Data" notice in the UI. The
   progression table below describes the display threshold.

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

| Method & path                                   | Purpose                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/reputation/leaderboard?corridor=…`    | Ranked anchors (optionally per-corridor).                                                                                      |
| `GET /api/reputation/[anchor]`                  | Current score + bands for one anchor.                                                                                          |
| `GET /api/reputation/[anchor]/history?window=…` | Historical score series.                                                                                                       |
| `POST /api/reputation/append`                   | Append a signed outcome tuple.                                                                                                 |
| `POST /api/reputation/dispute`                  | File a dispute against an outcome.                                                                                             |
| `POST /api/reputation/reconcile`                | Reconcile aggregates (maintenance).                                                                                            |
| `POST /api/reputation/refresh`                  | Refresh materialized aggregates.                                                                                               |
| `GET /api/reputation/sdf-export`                | Candidate export for SDF's Anchor Directory — see [`docs/ANCHOR_DIRECTORY_CONTRIBUTION.md`](ANCHOR_DIRECTORY_CONTRIBUTION.md). |

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

| Field            | Value                 |
| ---------------- | --------------------- |
| `state`          | `"insufficient_data"` |
| `sampleSize`     | `0`                   |
| `compositeScore` | `null`                |
| `scoreBand`      | _(not assigned)_      |

### Accruing Reputation

As the anchor processes transactions, each terminal outcome (completed,
partial, refunded, expired, or error) is appended to the outcome log
([`types/reputation.ts`](../types/reputation.ts)). Rolling scorecards
aggregate these outcomes over 7-, 30-, and 90-day windows.

The composite score formula
([`lib/reputation/composite.ts`](../lib/reputation/composite.ts)) combines the
three factors as:

```
composite = fillRate × (1 − slippage) ÷ (settleSeconds / 300)
```

A score of `1.0` means a perfect fill, zero slippage, at exactly the 300-second
reference settle time; values above `1.0` indicate faster-than-reference
settlement. Aggregation over each window uses a **flat window** — every
transaction in the window contributes with equal weight, with no exponential
decay or recency bias ([`lib/reputation/aggregate.ts`](../lib/reputation/aggregate.ts)).

**Progression toward live status:**

| Outcomes | Scorecard `state`   | Score Band          | Phase     |
| -------- | ------------------- | ------------------- | --------- |
| 0        | `insufficient_data` | _(none)_            | bootstrap |
| 1–29     | `insufficient_data` | _(none)_            | bootstrap |
| 30+      | `ok`                | green / amber / red | live      |

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

  | Band  | Score range | Label             |
  | ----- | ----------- | ----------------- |
  | green | ≥ 95        | Excellent         |
  | amber | 80 – 94     | Needs Improvement |
  | red   | < 80        | Critical          |

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
