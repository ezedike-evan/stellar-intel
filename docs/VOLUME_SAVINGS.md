# On-Chain Volume + Savings Oracle

> An independently verifiable "fees saved" metric — proof that routing through
> Stellar Intel beats the alternative, published on-chain rather than claimed
> in marketing copy.
>
> Source of truth: [`contracts/reputation/src/volume_savings.rs`](../contracts/reputation/src/volume_savings.rs)
> (`VolumeSavings` struct, `add_volume_savings` / `get_volume_savings` entrypoints).

---

## Methodology

### "Fees saved" definition

For each executed intent, the **savings** is the difference between the
baseline cost and the actual cost, expressed in USDC:

```
savings = baseline_received - actual_received
```

Where:

- **`actual_received`** — the fiat amount the user actually received after
  all anchor fees, derived from the delivered rate in the settled outcome.
- **`baseline_received`** — the fiat amount the user would have received
  using a reference baseline rate.

### Baseline selection

The baseline is determined using the following priority order:

1. **Anchor's own indicative rate** at intent time (from SEP-24 `/fee` or
   SEP-38 `QUOTE` response). This captures what the user would have gotten
   if they went directly to that same anchor without Stellar Intel routing.
2. **Corridor median rate** — the median of all available anchor rates for
   the corridor at the time of execution, used when the anchor-specific
   baseline is unavailable (e.g. the anchor only provides a firm quote
   post-routing).
3. **Previous published corridor rate** — the last on-chain corridor rate
   published by `publish_corridor_rate`, used as fallback when neither
   anchor-specific nor corridor-median data exists.

### Volume tracking

Cumulative volume is the sum of all `actual_received` values (in USDC
equivalent) for the corridor. This is the total value that flowed through
Stellar Intel's routing for that corridor.

### On-chain publishing

Volume and savings are published by the same publisher service that submits
outcomes (see `packages/publisher/src/batch.ts`). Each settlement triggers:

1. Outcome submission to the reputation oracle (`submit_outcome`).
2. Volume + savings increment via `add_volume_savings`.

Both values are **cumulative and monotonically increasing**. A consumer can
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
