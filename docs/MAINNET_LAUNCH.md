# Mainnet Launch

This document contains the checklist and guidance for mainnet launches. It includes a dedicated section describing how to rehearse a rollback on testnet and how to record observations.

## Rollback Rehearsal (Testnet)

Purpose: verify the upgrade rollback procedure against a testnet deployment and record observations so a real mainnet rehearsal has a baseline.

Prerequisites:
- A local clone of the repository and working Node toolchain (Node >=16, pnpm or npm).
- Credentials and testnet keys configured in an `.env.testnet` file.
- Familiarity with the project's deploy scripts (see `scripts/mainnet-preflight.mts`).

High-level approach:
1. Deploy the current release to a dedicated testnet environment.
2. Record a precise baseline of contract addresses, config, balances, and observable behavior.
3. Perform the planned upgrade (the same migration intended for mainnet) on testnet.
4. Rehearse the rollback procedure to return the testnet deployment to the baseline state.
5. Record observations at every step in the Observation Log below.

Step-by-step rehearsal

1) Setup
- Clone the repo and install dependencies:

  - `git clone <repo>`
  - `cd stellar-intel`
  - `pnpm install` (or `npm install`)

- Create `.env.testnet` from the example and populate testnet keys.

2) Deploy baseline to testnet
- Use your project's deploy procedure but target testnet. Replace the example command below with the actual deploy command used by your team:

  - `NODE_ENV=test node ./scripts/deploy-oracle.mts --network testnet`

- Record the output and the following baseline artifacts in the Observation Log:
  - Contract addresses and transaction hashes
  - Deployer and admin keys used (record public keys only)
  - On-chain config values and storage snapshots (key-value dumps)
  - Token/account balances for any funded accounts
  - End-to-end smoke tests: sample API responses or on-chain call results

3) Perform the upgrade (test)
- Run the exact migration/upgrade steps planned for mainnet, pointed at testnet. Example placeholder:

  - `node ./scripts/mainnet-preflight.mts --network testnet --run-migration <migration-id>`

- Observe and record:
  - Migration transaction hashes and confirmations
  - Any logs or errors emitted by the migration scripts
  - Service/API behavior after migration

4) Rehearse rollback
- Execute the planned rollback steps for mainnet against the testnet deployment. Typical actions include:
  - Pause or disable consumers and services that use the contract
  - Re-deploy previous contract code or run the revert migration
  - Restore on-chain storage from the snapshot or run compensating transactions
  - Re-run smoke tests and sanity checks

- Example placeholder rollback command (replace with project-specific script):

  - `node ./scripts/rollback-oracle.mts --network testnet --from-snapshot snapshots/testnet-baseline.json`

- Record precise timestamps, commands executed, outputs, and whether each step succeeded.

5) Verify baseline restored
- Run the same smoke tests from step 2 and compare results to the baseline. Note any divergences and add them to the Observation Log.

Observation Log (template)

| Step | Command | Expected Result | Actual Result | Tx/Log Links | Timestamp | Notes |
|------|---------|-----------------|---------------|--------------|-----------|-------|
| baseline-deploy | `node ./scripts/deploy-oracle.mts --network testnet` | contracts deployed, addresses output | | |  | |

Suggested recordings to attach to a rehearsal run:
- Raw script outputs (stdout/stderr) saved to files
- Snapshot JSON of contract state and balances
- Smoke test request/response traces
- A brief narrative describing surprises and time taken for each step

Checklist for an acceptable rehearsal
- The documented commands are runnable by an engineer unfamiliar with the repo (given testnet keys)
- Observation Log fully populated
- Any manual interventions are enumerated and converted into explicit steps or automation work items

If you need help converting a manual rollback step into a script, open an issue with the exact step and sample outputs.
