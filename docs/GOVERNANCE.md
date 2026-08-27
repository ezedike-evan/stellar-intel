# Governance: Multisig Contract Administration

**Last reviewed:** 2026-08-26

This document covers how the Stellar Intel reputation contract transitions from
a single-key admin to community-governed multisig, the ongoing signer-change
process, and the emergency procedures that protect the protocol during that
transition.

## Background

The reputation contract (`contracts/reputation/`) stores one `Address` as the
contract admin. That address controls anchor registration, publisher
authorization, and contract upgrades. At genesis the address was a
single HSM-backed key held by the core team. This document defines the path to
distributing that authority across a multisig signer set.

## How Stellar multisig applies here

Soroban's `Address::require_auth()` delegates signature verification to the
Stellar host. If the stored admin address is a Stellar account with M-of-N
signers, any transaction that includes admin calls must carry signatures from at
least M of those N accounts. No contract-level vote counting is needed — the
host enforces the threshold.

**Target configuration:**

- N = 5 signers (community maintainers + core team)
- M = 3 (medium threshold on the multisig account)
- Low threshold remains 1 (for read operations that don't mutate)

## Migration runbook

### Prerequisites

- Rust toolchain + `cargo` with the `soroban` CLI installed.
- Stellar account with sufficient XLM for transaction fees.
- Authorization from the current admin (private key access).

### Step 1 — Create the multisig account

Create a new Stellar account or convert an existing one to multisig. Set the
medium threshold to the required quorum and add each signer:

```bash
stellar account set-options \
  --source <MULTISIG_ACCOUNT> \
  --med-threshold 3 \
  --add-signer <SIGNER_1_PUBLIC_KEY> --weight 1 \
  --add-signer <SIGNER_2_PUBLIC_KEY> --weight 1 \
  --add-signer <SIGNER_3_PUBLIC_KEY> --weight 1 \
  --add-signer <SIGNER_4_PUBLIC_KEY> --weight 1 \
  --add-signer <SIGNER_5_PUBLIC_KEY> --weight 1
```

Verify the threshold and signer list on Stellar Expert or Horizon before
proceeding.

### Step 2 — Propose the multisig account as the new admin

The current single-key admin calls `propose_admin` on the contract, nominating
the multisig account:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <CURRENT_ADMIN_KEY> \
  -- propose_admin \
  --caller <CURRENT_ADMIN_ADDRESS> \
  --candidate <MULTISIG_ACCOUNT_ADDRESS>
```

Verify the pending candidate is stored:

```bash
stellar contract invoke --id <CONTRACT_ID> -- pending_admin
# Returns the multisig account address
```

### Step 3 — Accept with the multisig account

At least M signers of the multisig account co-sign a transaction calling
`accept_admin`. This can be done with the Stellar Laboratory (multi-sig
XDR flow) or by collecting signatures out-of-band and submitting the composed
transaction:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <MULTISIG_ACCOUNT> \
  -- accept_admin \
  --candidate <MULTISIG_ACCOUNT_ADDRESS>
```

Because the medium threshold is 3, the transaction envelope must carry
signatures from at least 3 of the 5 signer accounts before it is valid.

### Step 4 - Verify

```bash
stellar contract invoke --id <CONTRACT_ID> -- admin
# Must return <MULTISIG_ACCOUNT_ADDRESS>

stellar contract invoke --id <CONTRACT_ID> -- pending_admin
# Must return None
```

### Step 5 - Retire the single key

Optionally reduce the old admin account's weight to 0 so it can no longer
sign for anything. Keep the keypair in offline storage for audit purposes.

## Signer-change governance process

Any change to the multisig signer set (adding a signer, removing a signer,
changing the threshold) follows this process:

1. **Proposal** - A current signer opens a GitHub Discussion in the
   `stellar-intel` repository tagged `governance/signer-change`. The proposal
   must include: the proposed new signer set, the reason for the change, and
   a 72-hour comment window.

2. **Review** - Existing signers comment with approval or objection. Objections
   block the change; disputes escalate to a maintainer vote.

3. **Approval** - After 72 hours with no blocking objections and at least M
   explicit approvals from current signers, the Discussion is marked resolved.

4. **Execution** - A Stellar `set_options` transaction is constructed with the
   new signer set and submitted with the required M-of-N signatures. The
   transaction hash is linked back to the Discussion for auditability.

5. **Record** - The Discussion is closed and linked from the CHANGELOG with the
   effective date.

### Emergency signer removal

If a signing key is compromised or a signer becomes unresponsive and must be
removed urgently:

- Any M (quorum) of remaining signers may submit a `set_options` transaction to
  remove the compromised key without waiting for the 72-hour window.
- The emergency action must be posted to the governance Discussion within 24
  hours with a full explanation.

## Contract upgrade governance

The contract upgrade authority (`init_upgrade` / `upgrade` entrypoints in
`src/upgrade.rs`) uses a separate `UpgradeAdmin` key. The same multisig
migration path applies: set `UpgradeAdmin` to the multisig account using the
same propose/accept flow as for the main admin:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <CURRENT_UPGRADE_ADMIN_KEY> \
  -- propose_upgrade_admin \
  --caller <CURRENT_UPGRADE_ADMIN_ADDRESS> \
  --candidate <MULTISIG_ACCOUNT_ADDRESS>
```

Then, co-signed by at least M signers of the multisig account:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  -- accept_upgrade_admin \
  --candidate <MULTISIG_ACCOUNT_ADDRESS>
```

Verify with `pending_upgrade_admin` (should be empty afterwards) and
`upgrade_admin` (should be the multisig). `cancel_upgrade_proposal` withdraws a
proposal that has not been accepted.

Two-step by design: the nominee must accept, so a mistyped address fails to
complete rather than permanently binding the code-replacement authority to an
account nobody controls.

Until the upgrade admin is migrated, any WASM upgrade requires the core-team
HSM key. This is documented in `docs/SECURITY.md`.

## Related

- [`docs/SDK_HANDOFF.md`](SDK_HANDOFF.md) - community SDK maintainer model
- [`docs/SECURITY.md`](SECURITY.md) - key handling and custody boundary
- [`docs/CONTRIBUTOR_LADDER.md`](CONTRIBUTOR_LADDER.md) - how contributors
  become maintainers and then signer candidates
