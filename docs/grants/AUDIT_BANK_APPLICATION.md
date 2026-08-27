# Soroban Security Audit Bank — Application Materials

**Last reviewed:** 2026-08-26
**Submission status: not submitted.** This document assembles the materials; the
submission itself is tracked separately in
[#717](https://github.com/ezedike-evan/stellar-intel/issues/717).

Before submitting, confirm the Audit Bank's current intake channel and required
format — the fields below are organised around what an auditor needs to scope
the work, which may not match the application form field-for-field.

---

## 1. Project summary

| Field         | Value                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Project       | Stellar Intel                                                                                  |
| Contract      | `reputation`                                                                                   |
| Repository    | [github.com/ezedike-evan/stellar-intel](https://github.com/ezedike-evan/stellar-intel)         |
| Contract path | [`contracts/reputation`](../../contracts/reputation)                                           |
| License       | MIT                                                                                            |
| Language      | Rust, `soroban-sdk` 22.0.0, edition 2021                                                       |
| Deployment    | Testnet only — `CCZ54NTEOVL2DKWCGJA5XHTHOGRDS7JHFKYWEC6QH2IMZLYNM3FBFKDG`, deployed 2026-07-09 |
| Mainnet       | Not deployed. A mainnet publish is gated in code on 90 days of probe coverage.                 |
| Value at risk | **None held.** See §6.                                                                         |

**What the contract does.** It is a public reputation record for Stellar
off-ramp anchors: authorized publishers submit execution outcomes and corridor
rate observations, the contract aggregates them per anchor and corridor, and any
third party can read the resulting scores without trusting the project's
backend. The off-chain half — probing, aggregation, the publisher pipeline — is
in the same repository.

---

## 2. Scope

**1,148 lines of Rust across 13 modules**, one contract, **28 public
entrypoints**.

| Module              | Lines | What it owns                                   |
| ------------------- | ----- | ---------------------------------------------- |
| `lib.rs`            | 299   | `#[contractimpl]` surface — all 28 entrypoints |
| `admin.rs`          | 117   | Admin identity, two-step transfer              |
| `score.rs`          | 93    | Composite score computation                    |
| `upgrade.rs`        | 84    | WASM replacement, separate upgrade admin       |
| `volume_savings.rs` | 80    | Cumulative volume + savings accumulator        |
| `migration.rs`      | 80    | v1 → v2 corridor storage migration             |
| `publishers.rs`     | 76    | Publisher authorization set                    |
| `storage.rs`        | 74    | `DataKey` variants, TTL handling               |
| `corridor_rate.rs`  | 58    | Corridor rate publish/read                     |
| `history.rs`        | 54    | Bounded outcome history per anchor             |
| `outcome.rs`        | 46    | Outcome submission and hashing                 |
| `anchors.rs`        | 41    | Anchor registry                                |
| `aggregate.rs`      | 35    | Per-corridor counters                          |
| `error.rs`          | 11    | Error enum                                     |

There is **no second contract**. `crates/stellar-intel-reputation` is a
`#![no_std]` read-only client crate for third-party contract authors; it holds no
state and is in scope only insofar as it must not misrepresent the contract's
interface.

---

## 3. The surfaces an auditor should price first

Listed in the order we would want them examined.

### 3.1 `upgrade(env, new_wasm_hash: BytesN<32>)` — arbitrary code replacement

`contracts/reputation/src/upgrade.rs`. Replaces the contract's entire bytecode
via `env.deployer().update_current_contract_wasm`, preserving storage. Gated on a
**separate** `upgrade_admin`, distinct from the operational `admin`, so a
compromised operational key cannot replace the code.

**Two known weaknesses we would like assessed, not defended:**

- **`init` is one-shot and there is no rotation path.** Once the upgrade admin
  is bound it can never be changed. A lost key means the contract can never be
  upgraded again; a compromised key cannot be revoked. Tracked as
  [#963](https://github.com/ezedike-evan/stellar-intel/issues/963).
- **On the currently deployed testnet contract, `init_upgrade` was never
  called.** `contract_version()` returns `0` and `upgrade_admin` is unset, so
  `apply` would panic. The deployed bytecode also predates the current source.
  The deployment will be refreshed before any audit engagement begins.

### 3.2 Two-step admin transfer

`propose_admin` / `accept_admin` / `cancel_admin_proposal` / `pending_admin` in
`admin.rs`. The proposed address must call `accept_admin` itself, so a
mistyped address cannot brick the role. Tested in
`contracts/reputation/tests/multisig.rs`, including that the old admin loses
authority immediately on handover.

Multisig governance requires **no contract change**: a Stellar account with
M-of-N signers is an `Address`, and `require_auth()` delegates threshold
enforcement to the host. The migration runbook is in
[`GOVERNANCE.md`](../GOVERNANCE.md); it is an operational task
([#964](https://github.com/ezedike-evan/stellar-intel/issues/964)), not code.

**Currently the operational admin and the upgrade admin are not two distinct
accounts on the deployed contract.** One key can both forge data and replace the
code. This is flagged by `scripts/verify-oracle-read.mts` on every nightly run
and will be resolved before mainnet.

### 3.3 Publisher authorization

`add_publisher` / `revoke_publisher` / `list_publishers` in `publishers.rs`,
gating `submit_outcome`, `publish_corridor_rate` and `add_volume_savings`. The
entire integrity of the reputation record rests on this set: an unauthorized
writer could fabricate an anchor's history.

`contracts/reputation/tests/auth_gaps.rs` (8 tests) and
`tests/permissions.rs`, `tests/revoke.rs` cover the intended boundaries. We
would specifically like the **negative** space audited — calls we did not think
to test.

### 3.4 Live storage migration — the highest-risk item

`migration.rs` plus the v1/v2 dual read surface (`get_corridor_aggregate` vs
`get_corridor_aggregate_v2`, `get_score_for_corridor` vs `..._v2`).
`migrate_corridor_v2` / `migrate_all_v2` recompute `composite_bps` from v1
metrics and write a new `DataKey::CorridorV2`, guarded by a `has(&v2_key)` check
for idempotency. **v1 keys are never deleted**, so existing readers keep working.

A schema migration executed against a deployed contract with live readers is the
riskiest thing in this repository. We would like it reviewed for partial-migration
states, `migrate_all_v2` behaviour under resource limits, and whether the
idempotency guard holds under a re-entrant call.

### 3.5 Arithmetic and storage lifetime

- `[profile.release]` sets **`overflow-checks = true`**, unusual for a size-optimised
  wasm build and deliberate here: a silently wrapping counter in a reputation
  aggregate is worse than a panic. Also `opt-level = "z"`, `lto = true`,
  `codegen-units = 1`, `panic = "abort"`, `strip = "symbols"`.
- `score.rs` computes a composite in basis points from ratios; we would like the
  rounding and division-by-zero paths reviewed against an empty sample.
- `storage.rs` owns TTL extension. `history.rs` bounds per-anchor history.
  Storage-exhaustion and entry-expiry behaviour are both in scope.

---

## 4. Test suite

**56 `#[test]` functions across 13 integration test files**, all under
`contracts/reputation/tests/`. There are **zero inline `#[cfg(test)]` modules in
`src/`** — auditors usually ask, so: every test is an integration test against
the public entrypoints, none reach into private state.

| File               | Tests | Focus                                      |
| ------------------ | ----- | ------------------------------------------ |
| `multisig.rs`      | 11    | Admin proposal / acceptance / cancellation |
| `auth_gaps.rs`     | 8     | Unauthorized-call boundaries               |
| `basic.rs`         | 6     | Init, registry, happy paths                |
| `corridor_rate.rs` | 5     | Corridor rate publish/read                 |
| `footprint.rs`     | 5     | Storage footprint bounds                   |
| `publishers.rs`    | 5     | Publisher set management                   |
| `corridor.rs`      | 4     | Corridor aggregation                       |
| `upgrade.rs`       | 4     | WASM upgrade authorization                 |
| `score.rs`         | 3     | Composite scoring                          |
| `gas.rs`           | 2     | Invocation cost bounds                     |
| `history.rs`       | 1     | Bounded outcome history                    |
| `permissions.rs`   | 1     | Admin-gated calls                          |
| `revoke.rs`        | 1     | Publisher revocation                       |

The read-only consumer crate `crates/stellar-intel-reputation` carries a further
**7 tests** in `tests/integration.rs`.

### CI

`.github/workflows/ci.yml`, job `soroban contract (reputation)`, on every PR:

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo build --target wasm32-unknown-unknown --release
```

A separate `rust` job runs `cargo test`, `cargo doc` and
`cargo publish --dry-run` for the consumer crate.

**Disclosure:** `contracts/reputation` was **not compiled by any workflow until
#908**, and had been failing to build since **#887**. It is stated here rather
than omitted — an auditor finding it is worse than being told.

---

## 5. Reproducing the build

```bash
git clone https://github.com/ezedike-evan/stellar-intel
cd stellar-intel

cargo test  --manifest-path contracts/reputation/Cargo.toml --locked
cargo clippy --manifest-path contracts/reputation/Cargo.toml --all-targets -- -D warnings
cargo build --manifest-path contracts/reputation/Cargo.toml \
  --target wasm32-unknown-unknown --release

# Read the deployed testnet contract
npx tsx scripts/verify-oracle-read.mts
```

`Cargo.lock` is committed. The interface is documented in
[`ORACLE_SPEC.md`](../ORACLE_SPEC.md), governance in
[`GOVERNANCE.md`](../GOVERNANCE.md), and a broader honest inventory of what this
project enforces versus claims in
[`PRODUCTION_AUDIT.md`](../PRODUCTION_AUDIT.md).

---

## 6. Value at risk, and why an audit still matters

**The contract holds no funds.** It has no token balances, no transfer path, and
no withdrawal. A total compromise steals nothing.

What a compromise does instead is **falsify a public record that other parties
are invited to rely on**. The contract exists so a third party can check an
anchor's track record without trusting this project's backend; an attacker who
can forge outcomes or replace the bytecode makes that record worse than useless,
because it still looks authoritative.

The honest framing of the ask: this is not a treasury audit. It is an integrity
audit of a small, public, append-mostly data structure with an upgrade path and
a live migration — and the thing being protected is whether anyone should
believe what it says.

---

## 7. Maintainer

| Field      | Value                                                                                  |
| ---------- | -------------------------------------------------------------------------------------- |
| Maintainer | Evan Ezedike · `@ezedike-evan`                                                         |
| Repository | [github.com/ezedike-evan/stellar-intel](https://github.com/ezedike-evan/stellar-intel) |
| Security   | Disclosure process in [`SECURITY.md`](../SECURITY.md)                                  |

Solo maintainer today. [`CONTRIBUTOR_LADDER.md`](../CONTRIBUTOR_LADDER.md)
defines the path to additional reviewers, and
[`SDK_HANDOFF.md`](../SDK_HANDOFF.md) defines community SDK maintainership.

---

## 8. Pre-submission checklist

- [ ] Confirm the Audit Bank's current intake channel and required format
- [ ] Redeploy `contracts/reputation` to testnet from current `main` (the
      deployed bytecode predates the source — §3.1)
- [ ] Call `init_upgrade` so an upgrade path exists
- [ ] Run `scripts/init-oracle-registry.ts` so the contract is not empty
- [ ] Separate the operational admin from the upgrade admin (§3.2)
- [ ] Update `.deployments/testnet.json`
- [ ] Submit, and record the confirmation reference here (#717)

