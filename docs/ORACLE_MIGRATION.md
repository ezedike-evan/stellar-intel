# Oracle Migration

This document describes the upgrade/migration process for the on-chain oracle components. It now includes a step-by-step rollback rehearsal and an Observation Log template to record results during a testnet rehearsal.

## Rollback Rehearsal (Testnet)

Goal: provide a clear, repeatable procedure that someone who has never deployed these contracts can follow to rehearse a rollback on testnet and record a baseline for mainnet rehearsals.

Prerequisites:
- Testnet keys in `.env.testnet` and access to any required testnet faucets
- Node toolchain and repo dependencies installed
- Scripts available in the `scripts/` folder

Procedure:

1. Prepare environment
- Ensure `NODE_ENV=test` and `--network testnet` or equivalent flags are used when invoking scripts.
- Create a directory to store rehearsal artifacts: `mkdir -p rehearsal-artifacts/testnet-<date>`

2. Baseline deploy
- Deploy current code to testnet and save the deploy logs, transaction hashes, and addresses to `rehearsal-artifacts/testnet-<date>/baseline.json`.

3. Run migration
- Execute the migration intended for mainnet, pointing at testnet. Save logs and transaction hashes.

4. Rehearse rollback
- Follow the rollback steps exactly as planned for mainnet, and record each command and output in `rehearsal-artifacts/testnet-<date>/rollback.log`.

5. Validate and compare
- Run smoke tests and store the results in `rehearsal-artifacts/testnet-<date>/smoke-results.json`.
- Diff the baseline and post-rollback outputs and note any differences.

Observation Log (template)

Step: baseline-deploy
Command: `node ./scripts/deploy-oracle.mts --network testnet`
Expected: Contracts deployed, addresses printed
Actual: 
Tx/hashes: 
Saved to: `rehearsal-artifacts/testnet-<date>/baseline.json`
Notes:

Step: migration
Command: `node ./scripts/mainnet-preflight.mts --network testnet --run-migration <id>`
Expected: Migration completes, contracts updated
Actual:
Tx/hashes:
Saved to: `rehearsal-artifacts/testnet-<date>/migration.json`
Notes:

Step: rollback
Command: `node ./scripts/rollback-oracle.mts --network testnet --from-snapshot rehearsal-artifacts/testnet-<date>/baseline.json`
Expected: Deployment state restored to baseline
Actual:
Tx/hashes:
Saved to: `rehearsal-artifacts/testnet-<date>/rollback.json`
Notes:

Attachments to include with the rehearsal run:
- `baseline.json`, `migration.json`, `rollback.json`, `smoke-results.json`
- Raw stdout/stderr logs for each script
- Any screenshots or monitoring graphs capturing system behavior during migration and rollback

Acceptance criteria for this doc update
- The procedure can be followed by an engineer who has never deployed these contracts (given a testnet keypair).
- The Observation Log template is complete and easy to use.
