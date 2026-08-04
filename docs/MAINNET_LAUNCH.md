# Mainnet Oracle Launch Runbook

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
| Anchor registry seeded                                             | preflight (`list_anchors`)              |
| Security audit complete                                            | **manual** — #716/#717                  |
| Keys in HSM/KMS per `docs/SECURITY.md`                             | **manual** — verify custody out of band |
| Rollback rehearsed                                                 | **manual** — section 5                  |

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
