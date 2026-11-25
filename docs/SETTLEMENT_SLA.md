# Settlement SLA ($100-capped)

**Last reviewed:** 2026-11-22

Primitive III of the execution layer ([`docs/ROADMAP.md`](ROADMAP.md), issue
#814): a settlement-guarantee product. For a **covered** off-ramp, Stellar Intel promises
the withdrawal settles within a guaranteed deadline; if it doesn't, the user is
eligible for a payout up to a **$100 cap**.

> **Status: underwriting + terms only.** This launch ships the fail-closed
> underwriting logic and these terms — not a live payout system. It is
> **hard-blocked** on the actuarial dataset reaching threshold (a real
> regulatory/financial-risk gate). No corridor is covered until the maintainer
> activates it against real data; the underwriting fails closed until then.

## Guarantee terms

| Term               | Value                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Cap**            | **$100** per covered intent (not raised in this issue)                                                                                                                               |
| **Coverage**       | Off-ramp intents whose amount is `> 0` and `≤ $100`, on a corridor/anchor pair the underwriting has marked SLA-eligible                                                              |
| **Guarantee**      | The withdrawal settles within `guaranteedSettlementMs` (derived from the pair's p95 settlement latency × a margin factor)                                                            |
| **Payout trigger** | A covered intent whose terminal outcome **breaches** the guarantee — `refunded`, `expired`, `error`, or `partial` — **or** `completed` past the guaranteed deadline (latency breach) |
| **Payout amount**  | `min(amount, $100)`                                                                                                                                                                  |
| **Not payable**    | A clean, on-time `completed` settlement                                                                                                                                              |

## Underwriting (eligibility)

A corridor/anchor pair is offered an SLA only when its actuarial aggregate
(`CorridorAggregate`, `lib/reputation/aggregate.ts`) clears **every** threshold
in `SlaUnderwritingConfig` (`lib/reputation/sla.ts`):

- a full actuarial **window** (default 90 days),
- a minimum settled-outcome **sample size**,
- a minimum **fill rate** (`successCount / txCount`),
- a bounded **p95 settlement latency**,
- a minimum **composite score** (`lib/reputation/composite.ts`).

`assessSlaEligibility()` is **fail-closed**: missing latency/composite data, a
short window, or any unmet threshold returns `{ eligible: false, reasons }`. A
pair can therefore never be underwritten on thin or poor data — which is exactly
what keeps the product inert until the dataset exists.

## Dispute process

Breach claims reuse the **existing reputation dispute surface** — no second
dispute path is introduced:

- `POST /api/reputation/dispute` (intentHash, publicKey, signature, anchorId,
  reason) records an `open` dispute. Filing does not change the outcome row; it
  is not flagged `disputed` and keeps counting in scoring while the dispute is
  open.
- A maintainer accepts or rejects the dispute through `POST /api/admin/disputes`,
  which sets the dispute's status to `accepted` or `rejected`. A confirmed
  breach on a covered intent is what authorizes the capped payout.

See [`docs/DISPUTES.md`](DISPUTES.md) for the full dispute flow.

## Execution SLA (public settle-time percentiles)

Stellar Intel publishes trailing 30-day settlement performance benchmarks and breach evaluations per anchor and corridor.

- **Window:** Trailing 30 days ending now (`SLA_WINDOW_DAYS`), restricted strictly to off-ramp withdrawals (`direction: 'withdraw'`).
- **What counts:** Attested, non-disputed outcome rows. Percentiles use `completed` rows with valid `settleSeconds`. The `terminalTxCount` counts all outcomes (completed, partial, refunded, expired, error) within the window.
- **Method:** Nearest-rank percentile computation (`rank = ceil(p / 100 × n) - 1`) quoting actual observed settlement latencies without interpolation and without outlier trimming. Unlike reputation scorecard latencies (which use weighted interpolation with MAD trimming to resist noise in ranking), execution SLA measurements deliberately avoid outlier trimming because trimming hides long-tail settlement delays and SLA breaches.
- **Minimum sample sizes:**
  - `SLA_MIN_SAMPLES = 30`: below 30 completed samples, state is `insufficient_data` and percentiles are withheld.
  - `SLA_P99_MIN_SAMPLES = 100`: 99th percentile (p99) is computed only when at least 100 completed samples exist (otherwise `null`).
  - `SLA_DAILY_MIN_SAMPLES = 5`: daily p95 points in the 30-day trend series require at least 5 completed samples on that UTC day.
- **Breach thresholds:** Declared in `constants/sla-thresholds.ts`. Default thresholds are 15 minutes for p95 (`DEFAULT_SLA_THRESHOLDS.p95Ms = 15 * 60 * 1000`, matching underwriting `maxP95SettlementMs`) and 60 minutes for p99 (`DEFAULT_SLA_THRESHOLDS.p99Ms = 60 * 60 * 1000`), with maintainer-tunable per-anchor overrides in `ANCHOR_SLA_THRESHOLDS`. An observed percentile strictly greater than the threshold triggers a `breach` status (`p95Ms > threshold.p95Ms` or `p99Ms > threshold.p99Ms`); values less than or equal to the threshold are `within`.
- **Surfaces:**
  - REST API: `GET /api/reputation/{anchor}/sla[?corridor=]`
  - GraphQL API: `Query.anchorSla`
  - MCP Tool: `intel.anchor.sla`
  - Web UI: Anchor page Execution SLA card (`components/anchors/ExecutionSlaCard.tsx`) and off-ramp route settlement annotations, both gated behind feature flag `NEXT_PUBLIC_EXECUTION_SLA`.

## Activation checklist (maintainer)

1. Confirm the actuarial dataset has reached threshold for the target pair(s).
2. Tune `SlaUnderwritingConfig` to the observed distribution.
3. Wire `assessSlaEligibility` into quoting (surface "SLA-covered" on eligible
   pairs ≤ $100) and `assessPayout` into the dispute-resolution flow.

Until step 1 is signed off, the underwriting stays fail-closed and no SLA is
offered.
