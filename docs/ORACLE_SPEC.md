# Soroban Reputation Oracle — Contract Spec

> Anchor reputation data written to Stellar's smart-contract layer. Any
> Soroban contract or off-chain consumer can read it without asking
> permission. This is the single piece of infrastructure that turns
> Stellar Intel from an app into a **layer**.

Status: **wave 2.1** — specification frozen; implementation in progress.

---

## Table of contents

- [Design goals](#design-goals)
- [Storage layout](#storage-layout)
- [Interface](#interface)
  - [Admin](#admin)
  - [Publisher (write path)](#publisher-write-path)
  - [Consumer (read path)](#consumer-read-path)
  - [Events](#events)
- [Publisher whitelist governance](#publisher-whitelist-governance)
- [Upgrade policy](#upgrade-policy)
- [Consumer contract example](#consumer-contract-example)
- [TypeScript read helpers](#typescript-read-helpers)
- [Security properties](#security-properties)

---

## Design goals

| Goal                       | Mechanism                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| **Public**                 | Every observation and every aggregate is readable by any caller, no auth.                 |
| **Permissionless to read** | Zero-fee `view` style calls via `simulateTransaction`. No allowlist.                      |
| **Write-restricted**       | Only whitelisted publishers can append. Rotatable.                                        |
| **Append-only**            | Corrections are new observations with `supersedes`, never deletes.                        |
| **Cheap to read often**    | Aggregates (rolling 30-day TrustScore) are pre-computed on write, keyed by `(anchor_id)`. |
| **Tamper-evident**         | Every aggregate record embeds a Merkle root over the observations that produced it.       |

---

## Storage layout

Keys use Soroban's persistent storage. No temporary or instance storage —
reputation is durable.

```rust
// Observation — the raw write, addressable by observation hash.
DataKey::Obs(obs_hash: BytesN<32>) ->
    Observation {
        publisher:   Address,
        anchor_id:   Symbol,        // e.g. symbol!("cowrie")
        corridor:    Symbol,        // e.g. symbol!("USDC_NGN")
        kind:        Symbol,        // quote_latency | fill_rate | ...
        value:       i128,          // fixed-point: 1e6 multiplier
        observed_at: u64,           // unix seconds
        excluded:    bool,
        supersedes:  Option<BytesN<32>>,
    }

// Aggregate — rolling 30d TrustScore per anchor, recomputed on write.
DataKey::Agg(anchor_id: Symbol) ->
    Aggregate {
        trust_score:        u32,   // 0..=10000 (basis points; display /100)
        fill_rate_bps:      u32,
        uptime_bps:         u32,
        price_eff_bps:      u32,
        settle_score_bps:   u32,
        dispute_score_bps:  u32,
        quote_stab_bps:     u32,
        n_observations_30d: u32,
        n_corridors:        u32,
        confidence:         Symbol, // low | medium | high
        computed_at:        u64,
        merkle_root:        BytesN<32>,
        weights_version:    u32,    // bumps on governance-approved change
    }

// Index — ordered list of anchor_ids. Consumers iterate this for scoreboard queries.
DataKey::AnchorIndex -> Vec<Symbol>
```

Storage TTL extension runs on every `publish()` call for the touched keys,
so active anchors never lapse.

---

## Interface

All functions take a single `env: Env` plus the named args below.

### Admin

```rust
fn init(admin: Address, weights_version: u32);
// Must be called once per contract deploy. Refuses if already initialised.

fn set_weights_version(admin: Address, new_version: u32);
// Bumps the weights_version. Does NOT retro-recompute history; future
// writes stamp the new version. Off-chain consumers must handle multiple
// weights_versions in the same timeseries.
```

### Publisher (write path)

```rust
fn publish(
    publisher:   Address,   // require_auth
    obs_hash:    BytesN<32>,
    anchor_id:   Symbol,
    corridor:    Symbol,
    kind:        Symbol,
    value:       i128,
    observed_at: u64,
) -> ();
// Stores the observation, then recomputes the aggregate for anchor_id
// using the on-chain implementation of the formula in docs/ANCHOR_REPUTATION.md.
//
// Reverts if:
//   - publisher is not whitelisted
//   - obs_hash already exists (idempotent by hash)
//   - observed_at is > 120s in the future or < 30d in the past

fn exclude(
    publisher:  Address,
    target:     BytesN<32>,   // observation being excluded
    reason:     Symbol,
    supersedes: BytesN<32>,   // the correction's own obs_hash
) -> ();
// Writes a correction observation. Does NOT delete the original; aggregates
// recompute ignoring excluded==true.
```

### Consumer (read path)

```rust
fn get_score(anchor_id: Symbol) -> Option<Aggregate>;
// Current TrustScore + component breakdown for one anchor.

fn get_scores_batch(anchor_ids: Vec<Symbol>) -> Vec<Option<Aggregate>>;
// Bulk read — a single invocation covers the leaderboard page.

fn get_observation(obs_hash: BytesN<32>) -> Option<Observation>;
// Audit: fetch a single observation by hash.

fn list_anchors() -> Vec<Symbol>;
// Iterate anchor_ids known to the oracle.
```

### Events

Emitted via `env.events().publish()`; indexed by Stellar Expert and the
Stellar Intel GraphQL layer.

```rust
// ("reputation", "observation")
(obs_hash: BytesN<32>, anchor_id: Symbol, kind: Symbol, value: i128)

// ("reputation", "aggregate")
(anchor_id: Symbol, trust_score: u32, weights_version: u32, computed_at: u64)

// ("reputation", "exclude")
(target: BytesN<32>, reason: Symbol)
```

---

## Publisher whitelist governance

Only whitelisted contract addresses can call `publish` / `exclude`.
The whitelist is a `Map<Address, PublisherMeta>` under `DataKey::Publishers`.

Lifecycle:

1. Initial set = `[router_signer_v1]`, owned by the core maintainer.
2. Additions require a governance PR (see
   [ANCHOR_REPUTATION § Governance](ANCHOR_REPUTATION.md#governance))
   plus an on-chain multisig transaction, once the multisig is deployed.
3. Rotation: `rotate_publisher(old, new)` — atomic swap, preserves history
   since observations are keyed by `publisher` for audit.
4. Emergency removal: any whitelisted publisher can call
   `remove_publisher(self)` to self-revoke. Removing another publisher
   requires admin.

Every whitelist change emits `("reputation", "whitelist", change_kind, address)`.

---

## Upgrade policy

The contract supports Soroban's `update_current_contract_wasm(new_hash)`
admin call. We constrain upgrades with three rules:

1. **Never migrate storage implicitly.** An upgrade that needs a storage
   migration ships a paired `migrate()` entrypoint; the maintainer invokes
   it explicitly in a separate transaction, not in the upgrade itself.
2. **Append-only storage schema.** No field removals. Deprecated fields
   stay, writes stop.
3. **Versioned events.** If an event shape changes, the new event topic
   gets a suffix (e.g. `"aggregate_v2"`) so downstream indexers can add
   a new handler without losing old data.

Upgrades are announced 14 days in advance in Discussions and are gated
on the same governance flow as weight changes.

---

## Consumer contract example

A minimal Soroban contract consuming the oracle to price-gate a swap:

```rust
#![no_std]

use soroban_sdk::{
    contract, contractimpl, Address, Env, Symbol, symbol_short,
};

mod oracle {
    soroban_sdk::contractimport!(file = "stellar_intel_oracle.wasm");
}

const MIN_SCORE: u32 = 7500; // 75.00 TrustScore threshold

#[contract]
pub struct GatedSwap;

#[contractimpl]
impl GatedSwap {
    pub fn swap_if_reputable(env: Env, oracle_id: Address, anchor_id: Symbol) {
        let client = oracle::Client::new(&env, &oracle_id);
        let agg = client.get_score(&anchor_id)
            .expect("anchor unknown to oracle");
        assert!(
            agg.trust_score >= MIN_SCORE,
            "anchor below reputation floor"
        );

        env.events().publish(
            (symbol_short!("gated"), symbol_short!("ok")),
            (anchor_id, agg.trust_score),
        );

        // … proceed with the swap …
    }
}
```

---

## TypeScript read helpers

For off-chain consumers (web UI, SDK, agents):

```ts
import { OracleClient } from '@stellarintel/sdk/oracle';

const oracle = new OracleClient({
  contractId: 'CA…',
  network: 'mainnet',
});

const cowrie = await oracle.getScore('cowrie');
console.log(cowrie.trustScore, cowrie.confidence);
//  → 8420, 'high'

const leaderboard = await oracle.getScoresBatch(['cowrie', 'bitso', 'click']);
leaderboard
  .filter((agg): agg is NonNullable<typeof agg> => agg !== null)
  .sort((a, b) => b.trustScore - a.trustScore)
  .forEach((a) => console.log(a.anchorId, a.trustScore));
```

Reads use `simulateTransaction` under the hood — zero fee, no network
latency to Horizon's submit endpoint.

---

## Security properties

- **No anchor key in the contract.** Anchors do not sign observations —
  the router's publisher key does. Trust is in the router + whitelist,
  not in the anchor.
- **Freshness is observable.** `computed_at` is every aggregate's
  timestamp; stale aggregates surface via the UI as grey.
- **No money moves through the oracle.** It stores scores, not balances.
  A compromise of the oracle cannot steal user funds; it can only
  mis-rank anchors.
- **Merkle commitments for observations.** Each aggregate embeds a
  Merkle root of the `obs_hash` values that produced it, so a consumer
  can verify inclusion without scanning history.

Threat model for the oracle specifically lives in
[`docs/THREAT_MODEL.md`](THREAT_MODEL.md) under _Oracle tampering_.
