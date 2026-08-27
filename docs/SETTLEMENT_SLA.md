# Settlement SLA ($100-capped)

**Last reviewed:** 2026-08-26

Primitive III of the execution layer (ROADMAP.md line 101, issue #814): a
settlement-guarantee product. For a **covered** off-ramp, Stellar Intel promises
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
  reason) marks the outcome row `disputed` with `disputedReason`.
- The disputed outcome is adjudicated through the same reputation flow; a
  confirmed breach on a covered intent is what authorizes the capped payout.

## Activation checklist (maintainer)

1. Confirm the actuarial dataset has reached threshold for the target pair(s).
2. Tune `SlaUnderwritingConfig` to the observed distribution.
3. Wire `assessSlaEligibility` into quoting (surface "SLA-covered" on eligible
   pairs ≤ $100) and `assessPayout` into the dispute-resolution flow.

Until step 1 is signed off, the underwriting stays fail-closed and no SLA is
offered.
