# Benchmarks

> Numbers that reviewers and anchor partners ask for. Updated each
> release; every claim below is backed by a reproducible script in
> `scripts/benchmarks/` and a captured dataset in `data/benchmarks/`.
>
> Last captured: **2026-04-20 (v0.9.x pre-release)** — treat the specific
> values as indicative until v1.0 ships.

---

## Table of contents

- [How to reproduce](#how-to-reproduce)
- [Corridor latency](#corridor-latency)
- [Quote-to-signed time](#quote-to-signed-time)
- [Success rate by anchor](#success-rate-by-anchor)
- [Split vs. single routing](#split-vs-single-routing)
- [Oracle read latency](#oracle-read-latency)
- [Methodology notes](#methodology-notes)

---

## How to reproduce

```bash
# Full suite — ~6 minutes of live API calls + 12 minutes of probe replay.
npm run bench

# Single corridor, faster (no probe replay).
npm run bench -- --corridor USDC_NGN --iters 50

# Export CSV for slide decks.
npm run bench -- --out benchmarks.csv
```

Every script is idempotent and emits JSON into `data/benchmarks/`. CI
re-runs the full suite nightly; the five-run median is published to the
public page at `/benchmarks` (v2).

---

## Corridor latency

Time from `POST /intents/quote` returning quotes to the user receiving
the best route. Measured against live anchor SEP-38 endpoints.

| Corridor   | Anchors polled |    p50 |      p95 |      p99 |
| ---------- | -------------: | -----: | -------: | -------: |
| USDC → NGN |              4 | 420 ms |   980 ms | 1 410 ms |
| USDC → MXN |              3 | 360 ms |   810 ms | 1 250 ms |
| USDC → BRL |              3 | 510 ms | 1 240 ms | 1 980 ms |
| USDC → PHP |              2 | 480 ms | 1 100 ms | 1 620 ms |
| USDC → KES |              2 | 690 ms | 1 400 ms | 2 200 ms |

Fan-out is parallel. The router's contribution to the p95 is < 40 ms —
most of the number above is anchor-side.

---

## Quote-to-signed time

The user-observed path. Starts when the rate table finishes rendering,
ends when Freighter returns a signature.

| Step                            |    p50 |    p95 |
| ------------------------------- | -----: | -----: |
| User reviews routes             |  8.2 s |   22 s |
| Clicks "Send"                   |      — |      — |
| Freighter popup open            | 310 ms | 620 ms |
| User signs                      |  2.1 s |    6 s |
| SDK posts signed envelope       | 180 ms | 340 ms |
| Anchor interactive URL returned | 260 ms | 540 ms |

Total p50: **~11 s**. Total p95: **~30 s**. The dominant component is the
user reading; the route-to-sign mechanical path is sub-second.

---

## Success rate by anchor

30-day rolling `fulfilled / (fulfilled + failed + expired)` on
real-user intents + probe traffic. Probe-only anchors flagged.

| Anchor  | Corridors                    | Volume (30d) | Fulfilled |  Fill rate | TrustScore |
| ------- | ---------------------------- | -----------: | --------: | ---------: | ---------: |
| cowrie  | USDC_NGN, USDC_KES           |        2 840 |     2 710 | **95.4 %** |         84 |
| bitso   | USDC_MXN, USDC_BRL, USDC_ARS |        1 920 |     1 780 | **92.7 %** |         81 |
| click\* | USDC_PHP                     |          360 |       318 | **88.3 %** |         72 |

\* Probe-heavy; real-user volume is still low. Confidence: `medium`.

Full dataset at `data/benchmarks/fill-rate-2026-04-20.json`.

---

## Split vs. single routing

When does splitting an intent across two anchors beat the best single
quote? Simulated over the corridor's anchor quote history; v2 will
execute for real.

| Notional (USDC) | Corridor   | Single best | 2-way split |     Savings |
| --------------: | ---------- | ----------: | ----------: | ----------: |
|             100 | USDC → NGN |     141 230 |     141 235 |  negligible |
|           1 000 | USDC → NGN |   1 410 200 |   1 410 900 | **+0.05 %** |
|          10 000 | USDC → NGN |  14 062 000 |  14 091 400 | **+0.21 %** |
|          50 000 | USDC → NGN |  70 110 000 |  70 620 000 | **+0.73 %** |
|         100 000 | USDC → NGN | 139 600 000 | 141 040 000 | **+1.03 %** |

The headline: **splitting matters above ~$5 000.** For retail sub-$1k
flows the single-anchor routing is already optimal. The router's
splitting heuristic kicks in at a configurable `MIN_SPLIT_NOTIONAL`
knob (default $2 500) so we do not incur extra anchor round-trips
for amounts where splitting is a rounding error.

---

## Oracle read latency

Direct Soroban reads via `simulateTransaction`. No tx submission, no
fees.

| Operation                       |    p50 |    p95 |
| ------------------------------- | -----: | -----: |
| `get_score(anchor_id)`          | 180 ms | 420 ms |
| `get_scores_batch(10 anchors)`  | 240 ms | 510 ms |
| `list_anchors()` (≤ 20 anchors) | 160 ms | 360 ms |

Run against mainnet-forked sandbox: the SDK client caches per instance
for 30 seconds; repeated reads within a session are ~2 ms.

---

## Methodology notes

- All measurements include TLS handshake and DNS lookup time.
- Latency numbers are wall-clock from the initiating host located in
  `us-east-1` (simulating a North American user) and `eu-west-2`
  (European). Regional skew is < 20 % for every corridor.
- Percentiles over ≥ 100 runs per corridor unless noted otherwise.
- Anchor-side latency spikes during anchor maintenance windows are
  excluded from the `p95` using the incident log
  (`data/incidents.json`); the raw dataset includes them so consumers
  can see the unfiltered distribution.
- We do not cherry-pick anchors. Every anchor that publishes a live
  SEP-38 endpoint is included; opt-outs are documented.

Every claim in this document has a source dataset; every dataset has a
capture date; every capture date has a rerun command. If a number feels
wrong, rerun the command and open an issue with the diff.
