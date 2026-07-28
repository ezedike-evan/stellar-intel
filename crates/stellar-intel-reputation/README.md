# stellar-intel-reputation

Thin Soroban read SDK for the [Stellar Intel](https://stellar-intel.vercel.app)
reputation oracle.

This is the on-chain-native consumer SDK. Unlike the TypeScript and Python
SDKs — which are REST wrappers around `/api/reputation/*` — this crate calls
the deployed [`contracts/reputation`](https://github.com/ezedike-evan/stellar-intel/tree/main/contracts/reputation)
contract directly from **inside another Soroban contract's execution
context**. There is no HTTP round trip: it's built with `#![no_std]` and
`soroban-sdk`'s `#[contractclient]` macro, so it only runs where a Soroban
`Env` is available (i.e. from within another contract), not as a standalone
off-chain binary.

The contract interface this crate wraps is documented in
[`docs/ORACLE_SPEC.md`](https://github.com/ezedike-evan/stellar-intel/blob/main/docs/ORACLE_SPEC.md)
in the main repository, including the deployed testnet contract id.

## Install

```toml
[dependencies]
stellar-intel-reputation = "0.2"
```

## Usage

```rust,ignore
use soroban_sdk::{Address, Env, String};
use stellar_intel_reputation::ReputationReader;

fn read_score(env: Env, oracle: Address, anchor_id: String, corridor: String) {
    let reader = ReputationReader::new(&env, oracle);

    // Composite score published for this (anchor, corridor) pair.
    let score = reader.corridor_score(anchor_id.clone(), corridor.clone());

    // Raw settlement totals for the same pair.
    let aggregate = reader.corridor_aggregate(anchor_id.clone(), corridor);

    // Client-derived success-rate score over the last 20 outcomes, when no
    // metrics have been published yet for that specific corridor.
    let fallback = reader.score_bps(anchor_id, 20);
}
```

See [`examples/consumer-contract`](https://github.com/ezedike-evan/stellar-intel/tree/main/examples/consumer-contract)
in the main repository for a complete, deployable Soroban contract built on
top of this crate.

## What this crate exposes

| Method                                    | Wraps contract entrypoint      | Returns                                                                                  |
| ----------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| `list_anchors()`                          | `list_anchors`                 | Every anchor id the oracle has data for.                                                 |
| `recent_outcomes(anchor_id, n)`           | `recent_outcomes`              | Last `n` outcome rows, most recent first (capped at 100).                                |
| `corridor_aggregate(anchor_id, corridor)` | `get_corridor_aggregate`       | `CorridorAggregate { total, successes, settle_seconds_sum }`                             |
| `corridor_score(anchor_id, corridor)`     | `get_score_for_corridor`       | `CorridorScore { composite_bps, fill_rate_bps, settle_seconds_p50, sample_size }`        |
| `read_aggregate(anchor_id, window)`       | derived from `recent_outcomes` | `ReputationAggregate` — client-side success-rate score, no reliance on published metrics |
| `score_bps(anchor_id, window)`            | derived from `read_aggregate`  | Just the score, in basis points.                                                         |

`corridor_score`/`corridor_aggregate` read whatever an admin has published
for that exact corridor via `set_corridor_metrics`/`submit_outcome`.
`read_aggregate`/`score_bps` compute a score client-side from raw outcome
rows instead, so they work even for a corridor with no published metrics —
use whichever fits your contract's trust assumptions.

## License

MIT
