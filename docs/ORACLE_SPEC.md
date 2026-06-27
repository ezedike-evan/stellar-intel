# Reputation Oracle — Soroban Contract Spec

The reputation oracle is a Soroban smart contract that stores anchor outcomes
on-chain so any consumer can read an anchor's track record without Stellar Intel's
permission.

Source of truth: [`contracts/reputation/`](../contracts/reputation/)
(`Cargo.toml`, `src/lib.rs`, `src/admin.rs`, `src/anchors.rs`, `src/outcome.rs`,
`tests/basic.rs`).

> **Status.** The contract is implemented and unit-tested
> (`contracts/reputation/tests/basic.rs`). Mainnet deployment, multi-signer admin,
> and the public read SDK are roadmap gates — see [`docs/ROADMAP.md`](ROADMAP.md)
> Wave 2.1. Do not assume a live mainnet address yet.

## Contract

`ReputationContract` (`#[contract]` in `src/lib.rs`). Entrypoints:

### Outcomes — `src/outcome.rs`, `src/lib.rs`

```rust
pub fn submit_outcome(/* … outcome fields … */) -> Result<(), Error>
```

Records a single anchor outcome (the on-chain mirror of an off-chain outcome
tuple — fill, slippage, settle latency). Writes are restricted to authorized
publishers via the admin gate.

### Anchor registry — `src/anchors.rs`

```rust
pub fn list(env: &Env) -> Vec<String>            // registered anchor ids
pub fn register(env: &Env, anchor_id: String) -> Result<(), Error>
```

### Admin — `src/admin.rs`

```rust
pub fn set_admin(env: &Env, admin: &Address) -> Result<(), Error>
pub fn get_admin(env: &Env) -> Option<Address>
pub fn require_admin(env: &Env, caller: &Address) -> Result<(), Error>  // internal gate
```

`require_admin` is the authorization check that guards `register` /
`submit_outcome`. Today this is single-admin; the 2-of-3 multi-signer upgrade is
tracked in the roadmap.

## Consuming the oracle

Off-chain, read the same data through [`/api/reputation/*`](ANCHOR_REPUTATION.md).
On-chain, a consumer contract calls the read entrypoints directly. A TypeScript
read helper and JS/Python example consumers are roadmap deliverables (Wave 2.1).

## Building & testing

```bash
cd contracts/reputation
cargo test            # runs tests/basic.rs
# soroban contract build  # (build/deploy per Soroban toolchain; roadmap for mainnet)
```

## Upgrade & governance

Publisher whitelist management and a time-locked upgrade path are specified in the
roadmap (Wave 2.1). Until those land, treat the deployed contract (testnet) as
admin-controlled and not yet production-governed.

## Related

- [`docs/ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md) — the scoring methodology fed
  into outcomes.
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — where the oracle sits in the system.
