# Oracle migration and rollback rehearsal

This is the operator rehearsal for a Soroban contract upgrade. The goal is not to re-run the deploy as a shortcut; the goal is to prove that a previously known-good deployment can be restored in a controlled way before mainnet.

If the launch checklist says "Rollback rehearsed", do this against a testnet deployment first and record every observation in a log. That log becomes the baseline for the real mainnet rehearsal.

## Why this exists

A deploy is not a rollback. A rollback is a restoration to a prior artifact and state, with a clear before/after comparison. If the upgrade changes storage layout, admin rights, or contract wasm, re-running the deploy does not restore the previous behavior.

This rehearsal is deliberately written so someone with no prior deployment experience can follow it.

## Required tools

- Soroban CLI installed and on PATH
- A funded testnet admin keypair
- The current contract wasm artifact and the previous known-good wasm artifact
- A place to save terminal output (copy/paste into a ticket, markdown file, or runbook notes)

## Environment variables

Use a shell profile or a temporary `.env` file for the rehearsal.

```bash
export NETWORK=testnet
export RPC_URL=https://soroban-testnet.stellar.org
export ADMIN_SECRET=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
export CURRENT_WASM=./target/wasm32-unknown-unknown/release/reputation_contract.wasm
export PREVIOUS_WASM=./artifacts/reputation_contract_prev.wasm
export CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

If you do not already have the contract ID, set it to the testnet deployment that you are rehearsing against.

## Step-by-step rehearsal

### Step 1: Confirm the starting point

Record the current contract metadata before any change.

```bash
soroban contract info --id "$CONTRACT_ID" --network "$NETWORK"
soroban contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- list_anchors
```

Record what you saw:

- contract ID
- current wasm hash or deployed version
- admin address
- registered anchors
- any existing data you expect to be preserved

This is the baseline for the real rehearsal. If the command fails, stop and fix the environment before continuing.

### Step 2: Build or fetch the previous known-good artifact

Use the exact wasm that was previously working, not the newest build.

```bash
# Example: use the previous artifact from a release or a saved build output.
ls -l "$PREVIOUS_WASM"
sha256sum "$PREVIOUS_WASM"
```

Record:

- filename
- SHA-256 hash
- source of the artifact (release bundle, tagged build, or release branch)

### Step 3: Upload the previous artifact to the testnet network

This simulates the rollback artifact, not a clean redeploy.

```bash
soroban contract upload --wasm "$PREVIOUS_WASM" --source "$ADMIN_SECRET" --network "$NETWORK"
```

Record:

- upload transaction hash
- uploaded wasm hash
- whether the upload succeeded without retries or errors

This proves the rollback artifact is valid on the network.

### Step 4: Confirm the current deployment is still the upgraded one

Before you upgrade or restore anything, confirm that the live contract is the version you intend to roll back from.

```bash
soroban contract info --id "$CONTRACT_ID" --network "$NETWORK"
```

Record:

- the live deployed wasm hash
- the current admin address
- the active contract state

This is the point where the team verifies: "we are rolling back from the upgrade we actually deployed, not from a stale artifact." 

### Step 5: Simulate the rollback as a controlled restore

The exact mechanism depends on your governance and contract tooling, but the rehearsal must follow the same path the mainnet rollback will use.

Typical pattern for a contract upgrade or restore:

```bash
# Example pattern only: adjust to your actual upgrade command.
# soroban contract upgrade --id "$CONTRACT_ID" --wasm "$PREVIOUS_WASM" --source "$ADMIN_SECRET" --network "$NETWORK"
```

If your deployment uses a different approval path, follow that path exactly and write down the commands used.

Record:

- exact command used
- transaction hash
- whether the transaction required signature collection or admin authorization
- whether the operation succeeded on the first attempt

### Step 6: Verify the contract after rollback

Immediately check the post-restore state.

```bash
soroban contract info --id "$CONTRACT_ID" --network "$NETWORK"
soroban contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- list_anchors
```

Then invoke any contract read path that matters for production behavior.

Example:

```bash
# replace with actual production-facing read calls
# soroban contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- recent_outcomes --anchor-id "example.anchor" --n 5
```

Record:

- live wasm/hash after rollback
- admin still matches the expected rollback key
- anchor registry is intact
- outcome reads work
- no state is missing or corrupted

### Step 7: Validate the rollback is complete

Check the behavior that would have broken if the rollback were incomplete.

At a minimum, verify:

- the contract still loads on the network
- the admin gate still works
- the read path is functional
- historical data remains readable
- the contract behavior matches the last known-good version

If any check differs from the baseline recorded in Step 1, stop and escalate. Do not proceed to a mainnet rehearsal.

## Baseline log template

Copy this into the deployment ticket and fill it in during rehearsal:

```text
Rollback rehearsal: <date>
Network: testnet
Contract ID: <id>
Previous known-good wasm: <path>
Previous wasm sha256: <hash>
Current deployed wasm before rollback: <hash>
Admin before rollback: <address>

Observed before rollback:
- list_anchors:
- read path output:
- admin state:

Rollback command used:
- <command>

Observed after rollback:
- post-rollback wasm hash:
- admin state:
- list_anchors:
- read path output:
- errors: none / details

Status:
- PASS / FAIL
- Operator:
- Reviewer:
```

## Release gate

Do not mark the mainnet launch as ready until the rollback rehearsal has been completed on testnet, logged, and reviewed by a second operator. The mainnet rollback is not considered rehearsed just because the deploy script ran again.

## Related

- [docs/MAINNET_LAUNCH.md](MAINNET_LAUNCH.md)
