# Oracle storage migration — v1 → v2

**Last reviewed:** 2026-08-26

The corridor aggregate changed shape. This is the runbook for executing that
migration against a deployed contract, and the compatibility guarantee for
anyone already reading v1.

**The guarantee first, because it is the question most readers have:
v1 keys are never deleted.** `migrate_corridor` writes a new key and leaves the
old one untouched, so a contract or script reading `get_corridor_aggregate` keeps
working indefinitely, before and after migration, with no cutover window and
nothing to coordinate. There is no deprecation date on the v1 read path.

---

## What changed

| Version | Data key                            | Tuple                                                                     |
| ------- | ----------------------------------- | ------------------------------------------------------------------------- |
| v1      | `DataKey::Corridor(anchor, corr)`   | `(fill_rate_bps, slippage_bps, settle_seconds_p50, n)`                    |
| v2      | `DataKey::CorridorV2(anchor, corr)` | `(fill_rate_bps, slippage_bps, **composite_bps**, settle_seconds_p50, n)` |

The only addition is `composite_bps`, and it is **derived, not new data**:
`migrate_corridor` recomputes it from the v1 metrics via
`score::compute_composite_bps(fill_rate_bps, slippage_bps, settle_seconds_p50)`.
Nothing is read from off-chain and nothing is lost.

Read entrypoints, all of which coexist:

| v1                            | v2                               |
| ----------------------------- | -------------------------------- |
| `get_corridor_aggregate(...)` | `get_corridor_aggregate_v2(...)` |
| `get_score_for_corridor(...)` | `get_score_for_corridor_v2(...)` |

The TypeScript readers in `lib/oracle/read.ts` call the v2 entrypoint and fall
back to v1 on error, so the app works against a contract in either state.

---

## Properties of the migration

**Admin-gated.** `migrate_corridor` and `migrate_all` both call
`admin::require_admin`, which calls `require_auth` on the admin address. If the
admin is an M-of-N multisig account (see [`GOVERNANCE.md`](GOVERNANCE.md)), the
threshold is enforced by the host — the contract needs no multisig awareness.

**Idempotent.** The first thing `migrate_corridor_unchecked` does is
`if env.storage().persistent().has(&v2_key) { return; }`. Re-running is a no-op,
so a migration interrupted by a resource limit can be re-invoked safely and only
the unmigrated pairs do work.

**Safe on missing data.** A pair with no v1 metrics migrates to
`(0, 0, composite_of_zeros, 0, 0)` rather than failing — `get`
`unwrap_or`s a zero tuple. This means `migrate_all` over a fleet where only some
anchors have history does not need the caller to know which.

**Not atomic across pairs.** `migrate_all` loops; there is no transaction
boundary around the set. A run that exhausts its resource budget leaves some
pairs migrated and some not. That state is **legal, not corrupt**: v1 readers
are unaffected, v2 readers see the pairs that landed, and re-running finishes
the rest.

---

## The corridor list

`migrate_all` walks the registered anchors × a hardcoded corridor list in
`contracts/reputation/src/migration.rs`:

```rust
const V2_CORRIDORS: &[&str] = &[
    "usdc-ngn", "usdc-kes", "usdc-mxn", "usdc-php", "usdc-brl", "usdc-ars",
];
```

**Adding a corridor to the app does not add it here.** This constant is compiled
into the contract, so extending it requires a contract change and a redeploy or
upgrade. Until that happens, a new corridor's aggregate is reachable via
`migrate_corridor` per pair, which takes the corridor as an argument and is not
bound by the list.

If you add a corridor to `constants/corridors.ts`, add it here in the same PR or
the fleet migration will silently skip it.

---

## Runbook

### Before

1. Confirm the deployed contract actually has the v2 entrypoints:

   ```bash
   npx tsx scripts/verify-oracle-read.mts
   ```

   The script prints `Contract version` and warns when the deployed bytecode
   predates the current source. **If it warns, stop** — migrating a contract
   without `migrate_all_v2` compiled in will simply fail, and the deployment
   needs refreshing first.

2. Note the current admin:

   ```bash
   stellar contract invoke --id <CONTRACT_ID> -- admin
   ```

3. Record the pre-migration read for at least one pair, so the post-check is a
   comparison rather than an assertion of plausibility:

   ```bash
   stellar contract invoke --id <CONTRACT_ID> \
     -- get_corridor_aggregate --anchor_id cowrie --corridor usdc-ngn
   ```

### Migrate

Whole fleet, one invocation:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEY> \
  -- migrate_all_v2 \
  --caller <ADMIN_ADDRESS>
```

If the admin is a multisig account, compose and co-sign the transaction the same
way as `accept_admin` — see [`GOVERNANCE.md`](GOVERNANCE.md) § "Accept with the
multisig account".

One pair at a time, for a corridor outside `V2_CORRIDORS` or to bound resource
usage:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEY> \
  -- migrate_corridor_v2 \
  --caller <ADMIN_ADDRESS> \
  --anchor_id cowrie \
  --corridor usdc-ngn
```

### After

1. Read both paths for the pair recorded above and confirm the first four
   fields match, with `composite_bps` inserted third:

   ```bash
   stellar contract invoke --id <CONTRACT_ID> \
     -- get_corridor_aggregate --anchor_id cowrie --corridor usdc-ngn
   stellar contract invoke --id <CONTRACT_ID> \
     -- get_corridor_aggregate_v2 --anchor_id cowrie --corridor usdc-ngn
   ```

2. Confirm the v1 path still answers — that is the compatibility guarantee, and
   it should be verified rather than assumed.

3. Re-run `migrate_all_v2`. It must be a no-op. If anything changes on the
   second run, the idempotency guard is not doing its job and that is a bug
   worth stopping for.

### If it fails partway

Re-run the same invocation. Already-migrated pairs short-circuit on the `has`
check, so the retry costs only the remainder. There is no rollback and none is
needed: v1 keys were never touched.

---

## What is deliberately not here

**A compatibility shim, and a cutover window.** Both were in the original scope
for #872 and both are omitted.

The premise for them was "third-party contracts already reading v1." As of
2026-08-05 that set is empty and structurally so: the deployment is testnet-only
(`CCZ54NTE…`), its anchor registry is empty, and no corridor rate has ever been
published — `publish_corridor_rate` exists on the contract but nothing in the
publisher calls it. Designing a shim against zero readers is speculative work,
and the property that actually protects a future reader — **v1 keys are never
deleted** — already holds and is now written down.

If a real third-party reader appears and a v1 removal is ever contemplated, that
is a new decision and belongs in [`VERSIONING.md`](VERSIONING.md)'s deprecation
process, not here.

---

## Related

- [`ORACLE_SPEC.md`](ORACLE_SPEC.md) — the contract interface
- [`GOVERNANCE.md`](GOVERNANCE.md) — admin custody and the multisig runbook
- [`VERSIONING.md`](VERSIONING.md) — the deprecation policy a future v1 removal
  would follow
- `contracts/reputation/src/migration.rs` — the implementation
- `contracts/reputation/tests/corridor.rs` — migration tests
