import testnetDeployment from '@/.deployments/testnet.json';

// ─── Deployed contract addresses (Issue #723) ─────────────────────────────────
//
// `.deployments/testnet.json` is written by scripts/deploy-oracle-testnet.ts and
// is the record of what is actually deployed. It was, however, only a record:
// the contract address was *also* hardcoded in lib/oracle/read.ts and in
// app/api/publisher/tick/route.ts.
//
// Three copies of an address that changes on every redeploy is a silent
// divergence waiting to happen — and the specific failure is nasty, because the
// publisher would keep writing to one contract while every read returned the
// other one's (empty) state. Nothing would error; the numbers would just be
// wrong.
//
// This module makes the deployment file the single source, so a redeploy that
// updates it updates everything.

interface DeploymentRecord {
  contractId: string;
  network: string;
  deployedAt: string;
}

const testnet = testnetDeployment as DeploymentRecord;

/** The reputation oracle deployed to testnet. */
export const TESTNET_ORACLE_CONTRACT_ID = testnet.contractId;

/** When that deployment was recorded, for surfacing in demos and diagnostics. */
export const TESTNET_ORACLE_DEPLOYED_AT = testnet.deployedAt;

/**
 * The oracle address to use, in precedence order:
 *   1. an explicit argument (tests, scripts targeting another deployment)
 *   2. `ORACLE_CONTRACT_ID` (a redeploy that has not been committed yet)
 *   3. the recorded testnet deployment
 */
export function resolveOracleContractId(explicit?: string): string {
  return explicit ?? process.env.ORACLE_CONTRACT_ID ?? TESTNET_ORACLE_CONTRACT_ID;
}
