# Mainnet launch checklist

This runbook is the launch gate for the Soroban reputation oracle. The key rule is simple: a launch is not complete until the rollback rehearsal has been run and recorded.

## Required gate

Before approving a mainnet deployment or upgrade, the operator must complete the rehearsal in [docs/ORACLE_MIGRATION.md](ORACLE_MIGRATION.md) against a testnet deployment. The gate is deliberately manual because a deployment is not the same as a rollback.

## Launch sequence

1. Confirm the exact contract artifact to deploy.
2. Verify the build, hash, and admin key material.
3. Deploy or upgrade the testnet contract.
4. Run the contract smoke tests and read checks.
5. Run the rollback rehearsal described in [docs/ORACLE_MIGRATION.md](ORACLE_MIGRATION.md).
6. Record every observed value before and after the rollback.
7. Do not proceed to mainnet until the rehearsal has a recorded PASS result.

## What to record

Every rehearsal should capture:

- contract id
- wasm hash before rollback
- wasm hash after rollback
- admin public key
- anchor registry and read outputs
- exact command sequence used
- result of each validation step
- operator and reviewer names

## Launch decision

If the rollback rehearsal fails, the deployment is not ready for mainnet. Fix the issue, re-run the rehearsal, and update the log. The real rollback must be rehearsed before a single mainnet transaction is approved.

## Related

- [docs/ORACLE_MIGRATION.md](ORACLE_MIGRATION.md)
- [docs/ORACLE_SPEC.md](ORACLE_SPEC.md)
