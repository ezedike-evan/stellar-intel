# Reputation Oracle — Soroban Contract Spec

**Last reviewed:** 2026-08-26

The reputation oracle is a Soroban smart contract that stores anchor outcomes
on-chain so any consumer can read an anchor's track record without Stellar Intel's
permission.

Source of truth: [`contracts/reputation/`](../contracts/reputation/)
(`Cargo.toml`, `src/lib.rs`, `src/admin.rs`, `src/anchors.rs`, `src/outcome.rs`,
`tests/basic.rs`).

> **Status.** The contract is implemented and unit-tested
> (`contracts/reputation/tests/basic.rs`) and deployed to testnet at
> `CCZ54NTEOVL2DKWCGJA5XHTHOGRDS7JHFKYWEC6QH2IMZLYNM3FBFKDG` (see
> `.deployments/testnet.json`), with `submitToOracle`
> (`packages/publisher/src/batch.ts`) wired against it. Mainnet deployment,
> multi-signer admin, and the public read SDK are roadmap gates — see
> [`docs/ROADMAP.md`](ROADMAP.md) Wave 2.1. Do not assume a live mainnet
> address yet.

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

`require_admin` is the authorization check that guards `register`.

### Custody

There are **two independent authorities**, and conflating them is the mistake to
avoid:

| Authority         | Storage key                | Can do                                              |
| ----------------- | -------------------------- | --------------------------------------------------- |
| Operational admin | `DataKey::Admin`           | register anchors, add/revoke publishers, migrations |
| Upgrade admin     | `UpgradeKey::UpgradeAdmin` | replace the contract WASM                           |

**Multisig requires no contract change.** Both are `soroban_sdk::Address`
values, so either may be a Stellar account with several signers and a threshold;
`require_auth()` delegates the threshold check to the host. The two-step handoff
(`propose_admin` → `accept_admin`, with `cancel_admin_proposal`) means authority
is never transferred to an address that cannot sign.

What matters operationally is therefore _which accounts these are_, not what the
contract supports. Read it back rather than assuming:

```bash
npx tsx scripts/verify-oracle-read.mts
```

It prints the admin, the upgrade admin, the pending admin and the contract
version, and warns when the two authorities are the same account — one
compromised key that can both forge data and replace the code.

> **Current testnet state (checked 2026-08-28, tracked in #1149).**
> `contract_version` is `0` and the upgrade admin is unset: the deployed
> bytecode is seven weeks old and predates both the constructor-based
> `__constructor(admin, upgrade_admin)` binding (see "Fresh deploy" below) and
> the authorization fixes in #907, so **the live testnet contract still has the
> unauthenticated `set_corridor_metrics` write path**. Re-deploy before
> treating testnet reads as trustworthy. The anchor registry is also empty, so
> every score read returns "no data". `scripts/deploy-oracle-testnet.ts` and
> `scripts/init-oracle-registry.ts` are ready to do this — see "Fresh deploy".

### Who can write what

Every state-changing entrypoint is gated. There are two gates, and which one
applies depends on whether the write is an operational data feed or a
governance action.

| Gate                                                         | Entrypoints                                                                                                                               |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Publisher** (`publishers::is_authorized` + `require_auth`) | `submit_outcome`, `set_corridor_metrics`, `publish_corridor_rate`, `add_volume_savings`                                                   |
| **Admin** (`admin::require_admin`)                           | `register_anchor`, `add_publisher`, `revoke_publisher`, `propose_admin`, `cancel_admin_proposal`, `migrate_corridor_v2`, `migrate_all_v2` |
| **Candidate self-auth**                                      | `accept_admin`                                                                                                                            |
| **Upgrade admin**                                            | `upgrade`                                                                                                                                 |

`set_corridor_metrics`, `migrate_corridor_v2` and `migrate_all_v2` were
**unguarded** until #907 — they took no caller at all, so any account could
forge an anchor's score inputs or trigger a state migration. Adding the gate was
a breaking ABI change: all three now take a leading caller `Address` and return
`Result<(), Error>`.

## Consuming the oracle

Off-chain, read the same data through [`/api/reputation/*`](ANCHOR_REPUTATION.md).
On-chain, a consumer contract calls the read entrypoints directly. A TypeScript
read helper and JS/Python example consumers are roadmap deliverables (Wave 2.1).

## Building & testing

```bash
cd contracts/reputation
cargo test                                          # runs tests/basic.rs
```

Deploying is its own section below — `scripts/deploy-oracle-testnet.ts` needs
two address env vars set first.

## Storage versions

The corridor aggregate exists in two shapes. Both are readable; **v1 keys are
never deleted**, so an existing reader keeps working across a migration with no
cutover window.

| Version | Read entrypoints                                         | Tuple                                                                 |
| ------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| v1      | `get_corridor_aggregate`, `get_score_for_corridor`       | `(fill_rate_bps, slippage_bps, settle_seconds_p50, n)`                |
| v2      | `get_corridor_aggregate_v2`, `get_score_for_corridor_v2` | `(fill_rate_bps, slippage_bps, composite_bps, settle_seconds_p50, n)` |

Migration is admin-gated and idempotent, via `migrate_corridor_v2` (one pair) or
`migrate_all_v2` (registered anchors × the compiled-in corridor list). The
runbook, including the corridor-list caveat and what a partial migration means,
is in [`ORACLE_MIGRATION.md`](ORACLE_MIGRATION.md).

## Upgrade & governance

Publisher whitelist management and a two-step admin transfer are implemented;
see [`GOVERNANCE.md`](GOVERNANCE.md) for the custody runbook. The upgrade
authority (`upgrade_admin`) is bound by the constructor at deploy time — see
"Fresh deploy" below — and, since #963, **can be rotated** via
`propose_upgrade_admin` / `accept_upgrade_admin` (two-step, mirroring the
operational admin's `propose_admin` / `accept_admin`; see
[`GOVERNANCE.md`](GOVERNANCE.md) § "Contract upgrade governance"). Treat the
deployed contract (testnet) as admin-controlled and not yet
production-governed.

## Fresh deploy

There is no in-place way to bind `admin`/`upgrade_admin` after the fact, or to
seed a version stamp onto an already-deployed contract — both happen once,
atomically, in `__constructor`, at the moment `stellar contract deploy` runs.
So "the deployed contract is missing an authority" (#1149) is fixed by
deploying a new contract instance, not by invoking anything on the old one.
This necessarily means abandoning whatever on-chain state (outcomes, the
anchor registry) the old contract held — there is no migration path between
two different contract IDs.

```bash
export ORACLE_ADMIN_ADDRESS=G...          # operational admin
export ORACLE_UPGRADE_ADMIN_ADDRESS=G...  # upgrade admin — a *different* account (see "Custody" above)
export SOROBAN_SOURCE_ACCOUNT=...         # funded deployer, or set ADMIN_SECRET_KEY

npx tsx --tsconfig tsconfig.scripts.json scripts/deploy-oracle-testnet.ts
```

If `.deployments/testnet.json` already names a contract, the script refuses to
overwrite it unless `FORCE_REDEPLOY=true` is also set — the abandonment above
is deliberate and not the default.

Then, in order:

```bash
# Seed the anchor registry (constants/anchors.ts) on the new contract.
ORACLE_CONTRACT_ID=<new contract ID> ADMIN_SECRET_KEY=... \
  npx tsx --tsconfig tsconfig.scripts.json scripts/init-oracle-registry.ts

# Confirm no ::warning:: lines remain.
npx tsx scripts/verify-oracle-read.mts
```

`verify-oracle-read.mts` succeeding with no warnings and a non-empty anchor
list is the acceptance bar #1149 sets — `contract_version()` non-zero,
`upgrade_admin` set to an account distinct from `admin`, and the registry
non-empty.

## Related

- [`docs/ORACLE_MIGRATION.md`](ORACLE_MIGRATION.md) — the v1 → v2 storage
  migration runbook and compatibility guarantee.
- [`docs/ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md) — the scoring methodology fed
  into outcomes.
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — where the oracle sits in the system.
