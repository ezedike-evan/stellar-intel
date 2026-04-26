# Anchor Reputation

> Anchors are rated, not ranked arbitrarily. Every quote, fill, failure,
> and settlement latency becomes an on-chain observation; the composite
> TrustScore is a deterministic function of those observations. We do not
> pick winners — the math does, and the math is public.

---

## Table of contents

- [Why reputation is a product](#why-reputation-is-a-product)
- [What we measure](#what-we-measure)
- [Composite TrustScore formula](#composite-trustscore-formula)
- [Outlier handling](#outlier-handling)
- [Confidence bands](#confidence-bands)
- [Dispute process](#dispute-process)
- [Data availability](#data-availability)
- [Carrot, not stick](#carrot-not-stick)
- [Governance](#governance)

---

## Why reputation is a product

A stablecoin off-ramp is only as good as its anchor. Rates drift, anchors
fail, wires stall for hours, and the user finds out at the end. The market
has no shared, durable record of which anchors honour their quotes —
every wallet has to rediscover it privately, every time.

Stellar Intel's bet: **if anchor performance is written to a neutral,
public, permissionless ledger, every wallet benefits and the best anchors
win on merit.** That is the reputation oracle. The primary product is not
the aggregator UI; the aggregator UI is the shop window for the oracle.

---

## What we measure

Observations are emitted by two sources:

1. **The router** — for every real user intent it processes:
   `quote_observed`, `signed_observed`, `submitted_observed`,
   `fulfilled_observed`, `failed_observed`.
2. **The probe bot** — a permission-less, scheduled worker that issues
   synthetic SEP-38 quotes against every listed anchor on a 60-second
   cadence. Probe observations never touch user funds and never submit
   an interactive flow; they exist only to keep the freshness signal
   honest even during low-traffic periods.

Each observation is a tuple:

```
(anchor_id, corridor, asset_pair, kind, value, timestamp, hash(intent?))
```

Where `kind ∈ {quote_latency, quote_spread, fill_rate, settle_latency,
dispute_rate, uptime}` and `value` is the observed quantity.

---

## Composite TrustScore formula

The composite is a weighted sum of six components, each normalised to
`[0, 1]` over a 30-day rolling window, then combined:

```
TrustScore = 100 × (
    0.25 · fill_rate
  + 0.20 · uptime
  + 0.20 · price_efficiency
  + 0.15 · settle_latency_score
  + 0.10 · dispute_score
  + 0.10 · quote_stability
)
```

Where:

| Component              | Definition                                                              | Higher is |
| ---------------------- | ----------------------------------------------------------------------- | --------- |
| `fill_rate`            | `fulfilled / (fulfilled + failed + expired)`                            | better    |
| `uptime`               | Fraction of 1-minute probe windows with a successful SEP-38 quote.      | better    |
| `price_efficiency`     | `1 − min(1, mean(spread vs. best-quote in window))`.                    | better    |
| `settle_latency_score` | `clamp(1 − (p95_settle_s / SLO_s), 0, 1)` where `SLO_s = 900` for fiat. | better    |
| `dispute_score`        | `1 − (disputes / fulfilled)` over the window.                           | better    |
| `quote_stability`      | `1 − stddev(mid) / mean(mid)` over one-hour quote samples.              | better    |

The weights are fixed in `lib/reputation/weights.ts`. Changes to the
weights require a governance vote (§ Governance). A change of weights
triggers a full recomputation of every anchor's score, never a silent
forward-only drift.

---

## Outlier handling

Two classes of outliers matter:

- **Tail failures during a known incident** (e.g. Horizon down). The
  router tags affected observations with `env_context` and excludes them
  from `fill_rate` computation. The incident log lives in
  `data/incidents.json`, authored post-hoc by a maintainer.
- **One-in-a-thousand quote spreads.** We winsorise at the 1st and 99th
  percentile before computing `price_efficiency`, so a single mis-quote
  cannot tank an anchor's score.

Outlier filtering never silently drops observations — filtered ones are
still emitted to the oracle, just flagged `excluded: true` with a reason
code. Consumers can recompute the score themselves without our flags and
should get the same answer modulo incidents.

---

## Confidence bands

A raw 100 means nothing if it comes from 12 observations. Every
TrustScore is published alongside:

- `n_observations_30d` — total sample size.
- `n_corridors` — number of distinct asset/country pairs observed.
- `confidence`:
  - `low` — `n_observations_30d < 200` **or** `n_corridors < 2`.
  - `medium` — between the low and high thresholds.
  - `high` — `n_observations_30d ≥ 1000` **and** `n_corridors ≥ 4`.

The UI shows the band as a halo on the numeric score; the API returns it
as an enum. A `low` confidence anchor is not a bad anchor — it is just
one we do not yet have enough signal on.

---

## Dispute process

An anchor can dispute any observation written against them. The process:

1. Anchor opens a GitHub issue using the `anchor-onboard.yml` form with
   type `dispute` and a reference to the observation hash.
2. Maintainers verify the on-chain record, the router trace (if it was
   a real intent), and anchor logs.
3. If the observation is wrong (stale session, client bug, misattribution),
   we write a **correction observation** — not a delete. The correction
   carries the original observation hash in `supersedes` and flips
   `excluded: true`. The score recomputes.
4. If the observation is right, the anchor gets a playbook entry in
   [`docs/ANCHOR_ONBOARDING.md`](ANCHOR_ONBOARDING.md#remediation-playbook)
   describing what to fix. No score adjustment.

Resolution SLO: 7 days. All disputes are logged in a public list at
`/public/disputes` so the process is auditable.

---

## Data availability

The reputation pipeline is dual-written:

- **On-chain**: the Soroban oracle stores the rolling 30-day aggregates
  per anchor. See [`docs/ORACLE_SPEC.md`](ORACLE_SPEC.md).
- **Off-chain**: raw observations are replicated to `data/observations.parquet`
  in the public S3 bucket, and a JSON snapshot ships with every release
  tag. Anyone can recompute the TrustScore from the raw feed.

Recomputation is tested in CI: the test suite loads a fixed corpus of
observations and asserts the scores match the values burnt into
`tests/reputation/golden.json`. Breaking the golden file is intentional
(we changed the formula) or a bug (we changed the formula by accident).

---

## Carrot, not stick

The messaging discipline matters. We will never:

- Publish a "wall of shame".
- Auto-close anchors off the UI based on a threshold. A low-TrustScore
  anchor is still listed; the user sees the number and chooses.
- Compute a composite that mixes performance with editorial judgement.

We will:

- Publish a monthly **Anchor Spotlight** in Discussions celebrating the
  highest climber (absolute or relative), with a link to the data.
- Provide every anchor with a private "what would move your score"
  recommendation when they ask for one, free.
- Credit every anchor that ships a fix in the release notes.

---

## Governance

Changes to:

- **Weights** (`lib/reputation/weights.ts`)
- **Component definitions**
- **Outlier-filter thresholds**
- **Confidence-band thresholds**

require a PR with:

1. A TestVector update in `tests/reputation/golden.json` showing the
   score delta for every listed anchor.
2. An ADR in `docs/ARCHITECTURE_DECISIONS/` stating why.
3. A 14-day public comment window in Discussions.
4. Sign-off from two maintainers from different organisations (once we
   have them; today, from the core maintainer plus one external
   anchor-side reviewer).

Ratified changes ship in the next minor release. No hotfixes to the
scoring logic.
