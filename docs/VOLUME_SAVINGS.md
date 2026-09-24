# On-Chain Volume + Savings Oracle

> An independently verifiable "fees saved" metric — proof that routing through
> Stellar Intel beats the alternative, published on-chain rather than claimed
> in marketing copy.
>
> Source of truth: [`contracts/reputation/src/volume_savings.rs`](../contracts/reputation/src/volume_savings.rs)
> (`VolumeSavings` struct, `add_volume_savings` / `get_volume_savings` entrypoints).

**Last reviewed:** 2026-09-24

---

## Methodology

### "Fees saved" definition

For each executed intent with `outcome === 'completed'`, the **savings** is the difference between the baseline cost in USDC and the actual quoted cost in USDC, clamped at zero (returning 0 if the outcome is not completed or if required amounts are missing):

```
baseline_cost = delivered_amount / baseline_rate
savings = max(0, baseline_cost - quoted_amount)
```

Where:

- **`quoted_amount`** — the actual USDC input amount for the route.
- **`delivered_amount`** — the fiat amount delivered to the recipient.
- **`baseline_rate`** — the reference exchange rate (fiat per 1 USDC).
- **`baseline_cost`** — the USDC amount that would have been required to deliver `delivered_amount` at the `baseline_rate`.

### Baseline selection

The baseline rate is determined using the following priority order:

1. **Anchor's own indicative rate** at intent time (`quoted_rate` from SEP-24 `/fee` or SEP-38 `QUOTE` response). This captures what the user would have gotten if they went directly to that same anchor without Stellar Intel routing.
2. **Corridor median rate** — the median of recent delivered rates for the corridor from attested outcomes, used when the anchor-specific indicative rate is unavailable or non-positive.

_(Note: Fallback to previously published on-chain corridor rates is not implemented; if neither indicative rate nor corridor median is available or positive, savings defaults to 0)._

### Volume tracking

Cumulative volume is the sum of all `quoted_amount` values converted to microUSDC (`quoted_amount × 1_000_000`) for completed outcomes in the corridor. This is the total USDC value that flowed through Stellar Intel's routing for that corridor.

### On-chain publishing

Volume and savings are published by the same publisher service that submits
outcomes (see `packages/publisher/src/batch.ts`). Each settlement triggers:

1. Outcome submission to the reputation oracle (`submit_outcome`).
2. Volume + savings increment via `add_volume_savings` (for completed outcomes).

Both values are **cumulative; only decreases when an admin calls `reset_volume_savings`**. A consumer can
read the latest snapshot and compare it against a previously recorded value
to compute the delta over any interval.

### Units

| Field              | Unit                           | Description                    |
| ------------------ | ------------------------------ | ------------------------------ |
| `volume_usdc`      | microUSDC (1 USDC = 1,000,000) | Cumulative settled volume      |
| `savings_usdc`     | microUSDC (1 USDC = 1,000,000) | Cumulative estimated savings   |
| `settlement_count` | count                          | Number of settlements included |
| `updated_at`       | ledger timestamp               | Last update time               |

### Verifiability

Anyone can independently verify the published numbers by:

1. Reading `get_volume_savings(corridor)` from the Soroban contract.
2. Replaying the outcome log for the corridor from the reputation store.
3. Applying the same methodology to confirm the cumulative totals match.

This ensures the numbers are not self-reported marketing claims but are
derived from on-chain evidence that any third party can audit.

---

## Related

- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — where the volume+savings oracle
  fits in the system.
- [`docs/ORACLE_SPEC.md`](ORACLE_SPEC.md) — the base reputation oracle spec.
- [`docs/ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md) — scoring methodology.
- [`contracts/reputation/src/volume_savings.rs`](../contracts/reputation/src/volume_savings.rs)
  — contract implementation.
