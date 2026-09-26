# Mainnet Oracle Launch Runbook

**Last reviewed:** 2026-08-26

The deploy procedure for the reputation oracle, plus the gates that must hold
before it runs. Tooling and runbook only — **the decision to launch is not made
here**, and is blocked on the 90-day probe window (#786) and the Soroban
Security Audit Bank audit (#716/#717).

> Run `npx tsx scripts/mainnet-preflight.mts` first. It checks every gate that
> can be checked mechanically and prints the rest as explicit sign-offs. Do not
> work down this document from memory.

---

## 0. Why the gates exist

The product's claim is that an anchor's score is independently verifiable
on-chain. That claim is worth less than nothing if the contract launches with an
empty or thin dataset: a confident-looking score derived from four samples is
more misleading than no score at all. "Never launch an empty credit bureau" is
the reason for the 90-day window, not a formality.

Two failures found while building this checklist show why each gate is
mechanical rather than remembered:

- The **testnet** contract's registry is empty, so every score read returns a
  zeroed tuple. Nothing surfaced that until something read it (#723).
- The **testnet** bytecode predates the authorization fixes in #907, so the
  unauthenticated `set_corridor_metrics` path is still live there. The fix was
  merged and looked done (#913).

Both would have been repeated on mainnet.

---

## 1. Preconditions

| Gate                                                               | Checked by                              |
| ------------------------------------------------------------------ | --------------------------------------- |
| Contract tests pass, wasm builds                                   | preflight (`cargo test`, wasm build)    |
| `STELLAR_NETWORK=mainnet` set explicitly                           | preflight — no default exists (#912)    |
| `MAINNET_DEPLOYER_KEY`, `PUBLISHER_SECRET`, `DATABASE_URL` present | preflight                               |
| ≥90 days of probe samples                                          | preflight (queries `probe_samples`)     |
| Deployed bytecode matches source                                   | preflight (entrypoint probe)            |
| Admin ≠ upgrade admin                                              | preflight (`getOracleGovernance`)       |
| Publisher ≠ admin                                                  | preflight (`Keypair.fromSecret`)        |
| Anchor registry seeded                                             | preflight (`list_anchors`)              |
| Security audit complete                                            | **manual** — #716/#717                  |
| Keys in HSM/KMS per `docs/SECURITY.md`                             | **manual** — verify custody out of band |
| Rollback rehearsed                                                 | **manual** — section 5.1                |

### Key model

Three keys govern the contract. Each is a distinct Stellar account and none may
be held by the same keypair as another.

| Key               | What it controls                                                                                                                                                             | Allowed in a deployment environment                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Admin**         | Anchor registration, publisher authorization, and admin rotation (`propose_admin`/`accept_admin`). Operator-level changes to what the oracle covers and who can write to it. | No. Kept offline; used from an operator's machine only.                                       |
| **Upgrade admin** | WASM upgrades via `init_upgrade`/`upgrade`. Can replace the contract entirely.                                                                                               | No. Kept offline; separate multisig from the admin.                                           |
| **Publisher**     | Submits outcomes and rates (`submit_outcome`, `set_corridor_metrics`, `publish_corridor_rate`). No authority over the registry, other publishers, or the contract itself.    | Yes. `PUBLISHER_SECRET` in the Vercel production environment holds this key and nothing else. |

The admin key carries considerably more authority than the publisher: it can
authorize or revoke any writer, begin an admin rotation, and alter what anchors
the oracle covers. A serverless runtime is a wide attack surface (env-var leak,
SSRF, a compromised dependency, a stray log line). Publisher-level exposure is
recoverable; admin-level exposure is not, because the admin can revoke and
replace the publisher before the situation is understood.

On testnet the admin and publisher share an account for convenience. That
shortcut must not carry over. The preflight check `Publisher is not the contract
admin` enforces this mechanically: it derives the public key from
`PUBLISHER_SECRET` and fails if it matches `admin()` read from the deployed
contract.

---

## 2. Deploy

```bash
export STELLAR_NETWORK=mainnet          # required; the tooling will not guess

# 1. Upload the wasm. Dry-run first, always.
npx tsx --tsconfig tsconfig.scripts.json scripts/deploy-oracle-mainnet.ts \
  --mode upload-wasm --dry-run
npx tsx --tsconfig tsconfig.scripts.json scripts/deploy-oracle-mainnet.ts \
  --mode upload-wasm --live
# → records the wasm hash

# 2. Deploy an instance from that hash.
npx tsx --tsconfig tsconfig.scripts.json scripts/deploy-oracle-mainnet.ts \
  --mode deploy-contract --wasm-hash <64-hex> --live
```

Record the resulting contract id in `.deployments/mainnet.json`, matching the
shape of `testnet.json`. **This is the source of truth** — `lib/oracle/deployment.ts`
reads it, so nothing else needs editing (#723).

---

## 3. Bind authorities before anything else

Do this before registering a single anchor. An unbound upgrade admin is an
open door.

```bash
# Operational admin: a multisig account, not a single key.
# Upgrade admin: a DIFFERENT multisig account.
```

Both are `Address` values, so multisig requires no contract change —
`require_auth()` delegates the threshold check to the host. Use
`propose_admin` → `accept_admin` for any later rotation, never a direct
overwrite: the two-step handoff makes it impossible to hand authority to an
address that cannot sign.

Verify, do not assume:

```bash
npx tsx scripts/verify-oracle-read.mts
```

It fails loudly when one account holds both roles.

---

## 4. Seed, then verify

```bash
npx tsx --tsconfig tsconfig.scripts.json scripts/init-oracle-registry.ts   # anchors
npx tsx scripts/verify-oracle-read.mts                                     # confirm
```

Publishing historical outcomes is the publisher's job, not a separate migration:
`packages/publisher` reads `outcome_log` and submits rows that are reconciled but
unpublished. Point it at mainnet and let it drain, rather than writing a bespoke
backfill that bypasses the same-path guarantees (per-row tx hashes and resumable
partial batches, #909).

Confirm before announcing anything:

- `list_anchors` returns the expected set
- `get_score_for_corridor` returns non-null for a seeded pair — a `null` means
  zero samples, which is what an empty registry looks like (#723)
- `contract_version` is non-zero

---

## 5. Rollback

**An upgrade is not undoable by re-running the deploy.** `upgrade()` swaps the
WASM in place and bumps the stored version; there is no downgrade path, and
storage is preserved across the swap, so a bad migration leaves bad state behind.

Therefore:

1. **Keep the previous wasm hash.** Rolling back means `upgrade()` to the old
   hash, which needs that hash on hand and the upgrade admin's signatures.
2. **Test the rollback on testnet first**, with the same multisig shape. A
   rollback rehearsed only on paper is not a rollback plan.
3. **Data damage is separate from code damage.** If a migration wrote wrong
   values, reverting the code does not revert them. Migrations are admin-gated
   (#907) and idempotent, but idempotent is not reversible.
4. **A compromised admin key is not a rollback scenario**, it is an incident.
   The upgrade admin can replace the contract with anything; that is why it must
   be a separate multisig from the operational admin.

### 5.1 Rehearsal on testnet

This is the procedure behind the **Rollback rehearsed** gate. It needs no prior
knowledge of the contract. It uses a throwaway contract instance, so it never
touches the shared deployment in `.deployments/testnet.json`.

**What it proves.** That the upgrade admin can move the contract to a new WASM
and back, that stored state survives both swaps, and that nobody else can do it.

**Facts the steps depend on** (from `contracts/reputation/src/upgrade.rs`):

- `upgrade(new_wasm_hash)` needs the **upgrade admin's** signature. The
  operational admin cannot call it.
- The version is bumped _before_ the swap, on every call. **Rolling back to the
  old WASM does not restore the old version**; it moves the version forward.
- `upgrade()` replaces code only. Anchors, outcomes and the registry are
  untouched, in both directions.

**You need:** the `stellar` CLI, Rust with the `wasm32v1-none` target, and two
funded testnet identities that are **different accounts**: one for `admin`, one
for `upgrade_admin`. Use the same multisig shape you will use on mainnet if you
can.

```bash
export NETWORK=testnet
stellar keys generate rehearsal-admin --network $NETWORK --fund
stellar keys generate rehearsal-upgrade --network $NETWORK --fund
export ADMIN_ADDR=$(stellar keys address rehearsal-admin)
export UPGRADE_ADDR=$(stellar keys address rehearsal-upgrade)
```

**Step 1: build and upload the current WASM (v1).**

```bash
(cd contracts/reputation && stellar contract build)
WASM=contracts/reputation/target/wasm32v1-none/release/reputation.wasm
sha256sum "$WASM"                                    # record as V1_SHA
V1_HASH=$(stellar contract upload --wasm "$WASM" --source rehearsal-admin --network $NETWORK)
cp "$WASM" /tmp/reputation-v1.wasm
```

**Step 2: deploy a fresh instance from v1.** The constructor binds both
authorities atomically, so both arguments are required.

```bash
CONTRACT_ID=$(stellar contract deploy --wasm-hash "$V1_HASH" --source rehearsal-admin \
  --network $NETWORK -- --admin "$ADMIN_ADDR" --upgrade_admin "$UPGRADE_ADDR")
```

**Step 3: seed the registry and take the baseline.** Seed as in
[`ORACLE_SPEC.md`](ORACLE_SPEC.md) "Fresh deploy" (`scripts/init-oracle-registry.ts`
with `ORACLE_CONTRACT_ID=$CONTRACT_ID`), then read:

```bash
for fn in contract_version admin upgrade_admin list_anchors; do
  echo "== $fn"
  stellar contract invoke --id "$CONTRACT_ID" --source rehearsal-admin --network $NETWORK -- $fn
done
```

**Step 4: upgrade to a different WASM (v2).** Rebuild after any change that
alters the binary (for the first rehearsal, a trivial edit is enough; revert it
afterwards), upload it, then upgrade **as the upgrade admin**.

```bash
(cd contracts/reputation && stellar contract build)
sha256sum "$WASM"                                    # record as V2_SHA; must differ from V1_SHA
V2_HASH=$(stellar contract upload --wasm "$WASM" --source rehearsal-admin --network $NETWORK)
stellar contract invoke --id "$CONTRACT_ID" --source rehearsal-upgrade --network $NETWORK \
  -- upgrade --new_wasm_hash "$V2_HASH"
```

Re-run the Step 3 reads. Expected: `contract_version` is `2`; the other three are
unchanged.

**Step 5: roll back to v1.** This is the rehearsal itself.

```bash
stellar contract invoke --id "$CONTRACT_ID" --source rehearsal-upgrade --network $NETWORK \
  -- upgrade --new_wasm_hash "$V1_HASH"
stellar contract fetch --id "$CONTRACT_ID" --network $NETWORK --out-file /tmp/reputation-live.wasm
sha256sum /tmp/reputation-live.wasm /tmp/reputation-v1.wasm   # must match
```

Re-run the Step 3 reads. Expected: `contract_version` is **`3`, not `1`**; the
other three are unchanged.

**Step 6: confirm nobody else can upgrade.**

```bash
stellar contract invoke --id "$CONTRACT_ID" --source rehearsal-admin --network $NETWORK \
  -- upgrade --new_wasm_hash "$V2_HASH"
```

Expected: the call **fails** authorization, and `contract_version` stays `3`.

**Step 7: record it.** Copy the table below into the sign-off (PR or issue) for
the mainnet launch, with the `Observed` column filled in. A step that does not
match `Expected` is a failed rehearsal, not a footnote.

| Step | Check                                 | Expected                      | Observed |
| ---- | ------------------------------------- | ----------------------------- | -------- |
| 2    | `contract_version` after deploy       | `1`                           |          |
| 2    | `admin` / `upgrade_admin`             | the two different accounts    |          |
| 3    | `list_anchors` count                  | equals `constants/anchors.ts` |          |
| 4    | V1_SHA vs V2_SHA                      | different                     |          |
| 4    | `contract_version` after upgrade      | `2`                           |          |
| 4    | `list_anchors` after upgrade          | unchanged from step 3         |          |
| 5    | live WASM sha256 vs V1_SHA            | identical                     |          |
| 5    | `contract_version` after rollback     | `3`                           |          |
| 5    | `list_anchors` after rollback         | unchanged from step 3         |          |
| 6    | upgrade signed by the admin           | fails authorization           |          |
| 6    | `contract_version` after that attempt | `3`                           |          |

The real launch rollback follows the same shape with two additions: keep the
previous mainnet WASM hash somewhere retrievable **before** upgrading, and
remember that reverting code does not revert data (point 3 above).

**Status:** no rehearsal has been recorded yet. The first operator to run this
fills in the `Observed` column and keeps the result as the baseline.

---

## 6. After launch

- `/api/publisher/health` reports the durable last-publish time; the reputation
  cron alerts when rows are pending and nothing has published for an hour (#910).
- The nightly `oracle-read` job reads the contract warn-only and reports
  registry, custody and version skew (#723, #913).
- Watch for the deployed-bytecode-predates-source warning after any source
  change to `contracts/reputation` — that is the signal that a merge has not
  reached the chain.

## Related

- [`docs/ORACLE_SPEC.md`](ORACLE_SPEC.md) — contract interface and custody model
- [`docs/SECURITY.md`](SECURITY.md) — key-handling requirements
- [`docs/ANCHOR_REPUTATION.md`](ANCHOR_REPUTATION.md) — the published scoring formula
