# Price Layer

> "Chainlink for emerging-market stablecoin FX."
>
> The canonical public rate feed for every corridor we observe. Distinct
> from the reputation oracle: this is the _price_ surface, aggregated
> across anchors and publishable into on-chain consumers.
>
> Status: **wave 3.x / v3** — specification in public draft.

---

## Table of contents

- [Why a separate price layer](#why-a-separate-price-layer)
- [Feed schema](#feed-schema)
- [Aggregation](#aggregation)
- [Staleness and freshness guarantees](#staleness-and-freshness-guarantees)
- [On-chain surface](#on-chain-surface)
- [Off-chain surface](#off-chain-surface)
- [Relationship to the reputation oracle](#relationship-to-the-reputation-oracle)
- [Open questions](#open-questions)

---

## Why a separate price layer

The reputation oracle answers _"who honours quotes?"_. The price layer
answers _"what is the corridor's actual rate right now?"_. These are
different questions and serving them from the same surface conflates
them.

The market need: every DeFi protocol that wants to price a local-fiat
stablecoin pair (USDC → NGN, USDC → MXN, …) currently either scrapes
anchor endpoints bespoke, or uses an external USD-only oracle and
assumes USD↔local is a flat peg (which it is not). A neutral,
cross-anchor, stale-resistant feed does not exist today.

We are already collecting the raw inputs. Publishing them as a feed is
the easier half; doing it in a way that doesn't create a single-point-
of-failure is the harder half.

---

## Feed schema

```rust
// On-chain, one record per (corridor, publication_window)
Rate {
    corridor:           Symbol,       // e.g. symbol!("USDC_NGN")
    window_start:       u64,          // unix seconds (inclusive)
    window_end:         u64,          // unix seconds (exclusive)
    mid_price_bps:      i128,         // fixed-point 1e6 scale
    bid_price_bps:      i128,
    ask_price_bps:      i128,
    n_quotes_in_window: u32,
    n_anchors:          u32,
    publisher:          Address,
    merkle_root:        BytesN<32>,   // over contributing quotes
    weights_version:    u32,          // rating-weights schema version
}
```

Typical publication window: 60 seconds. `mid_price` is the trustscore-
weighted median of anchor quotes in the window; `bid` and `ask` are the
10th / 90th percentile of the same set.

---

## Aggregation

Every anchor quote contributes to the aggregate with weight
`trust_weight`, where:

```
trust_weight = clamp(trust_score_bps / 10000, 0.2, 1.0)
```

The floor of 0.2 ensures a brand-new anchor with insufficient history
still contributes — we do not silently drop its quote, just down-weight
it. The ceiling is 1.0; no anchor gets a super-sized vote.

Quotes older than the window's `window_start` are discarded even if the
anchor only fired one quote in the window. Quotes flagged `excluded =
true` in the reputation feed are excluded here as well.

Median is used, not mean. A mis-quote at 100× the real rate cannot move
a median with ≥ 3 contributors; it can move a mean. Adversarial pricing
manipulation is therefore bounded by the number of anchors a single
attacker controls in a given corridor.

---

## Staleness and freshness guarantees

Every feed record stamps `window_end` + a `published_at` wall-clock. A
consumer computes:

- `age = now - published_at` — how long ago the record went on-chain.
- `staleness = now - window_end` — how long ago the window closed.

We commit to `staleness ≤ 90s` in normal operation and surface the
current value on the public `/feed/{corridor}` page. During anchor
outages that drop `n_anchors` below 2, we emit a `degraded` event
on-chain and let consumers choose whether to accept or reject the
record.

Reading consumers should:

1. Check `staleness ≤ their own tolerance` before use.
2. Check `n_anchors ≥ 2` before trusting the median.
3. Check `confidence` on the equivalent reputation record; a feed
   produced from low-confidence anchors is a low-confidence rate.

---

## On-chain surface

The price layer ships as a second Soroban contract, distinct from the
reputation oracle but sharing governance. Public read API:

```rust
fn get_rate(corridor: Symbol) -> Option<Rate>;
fn get_history(corridor: Symbol, since: u64) -> Vec<Rate>;
fn list_corridors() -> Vec<Symbol>;
```

No write API outside whitelisted publishers; same whitelist governance
as the reputation oracle (see
[`docs/ORACLE_SPEC.md § Publisher whitelist`](ORACLE_SPEC.md#publisher-whitelist-governance)).

---

## Off-chain surface

For consumers that would rather not pay for Soroban reads:

- **REST**: `GET /v1/public/rates/:corridor` — latest window record.
- **WebSocket**: `/v1/public/rates/stream?corridor=…` — new record per
  window.
- **Parquet replica**: `data/rates/*.parquet` — full history, for
  backtesting.

Both surfaces are read-only and require no auth. Rate limits are
generous (`10 rps` per IP) because every consumer of a price feed
polls.

---

## Relationship to the reputation oracle

Shared: the whitelist governance, the publisher key set, the dispute
process, the upgrade policy, and the weights-version concept.

Distinct:

- Reputation = persistent behaviour. Price = ephemeral market state.
- Reputation updates on fulfilment (minutes). Price updates every
  window (60 s).
- Reputation consumers are user-facing (does this anchor honour?).
  Price consumers are machine-facing (what is the number?).

Running both in one contract would conflate the update cadences and
blur the access patterns. Splitting them lets each contract stay
small, auditable, and independently upgradable.

---

## Open questions

_(Marked as **OQ-1**, **OQ-2** so we can reference them in review.)_

**OQ-1.** Should the feed be per-asset-pair or per-corridor? Corridor
implies geography (USDC_NGN is not USDC_USD in Nigeria); pair avoids
embedding a country code in the key. Current plan: pair, with a
per-country index built at read-time.

**OQ-2.** Do we need a sliding window or fixed 60 s buckets? Fixed
buckets simplify indexing but dilute recency on quiet corridors.
Current plan: fixed, revisit once we see real-corridor quote density.

**OQ-3.** Publication latency budget — anchor quote → on-chain
aggregate. Target: p95 < 30 s. Blockers: publisher contract invocation
cost, Soroban's `simulateTransaction` behaviour under write bursts.

**OQ-4.** How should consumers handle a `degraded` event? Current
thinking: surface the event as a field on the next record rather than
interrupt the stream.

Answers accumulate in
[`docs/ARCHITECTURE_DECISIONS/`](ARCHITECTURE_DECISIONS/) as ADRs.
