import testnetDeployment from '@/.deployments/testnet.json';
import mainnetDeployment from '@/.deployments/mainnet.json';

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
// This module makes the deployment files the single source, so a redeploy that
// updates one updates everything. `.deployments/mainnet.json` has the same shape;
// an empty `contractId` there means "not deployed yet".

interface DeploymentRecord {
  contractId: string;
  network: string;
  deployedAt: string;
}

const testnet = testnetDeployment as DeploymentRecord;
const mainnet = mainnetDeployment as DeploymentRecord;

/** The reputation oracle deployed to testnet. */
export const TESTNET_ORACLE_CONTRACT_ID = testnet.contractId;

/** When that deployment was recorded, for surfacing in demos and diagnostics. */
export const TESTNET_ORACLE_DEPLOYED_AT = testnet.deployedAt;

/**
 * The reputation oracle deployed to mainnet, or an empty string while none has
 * been deployed and recorded in `.deployments/mainnet.json`.
 */
export const MAINNET_ORACLE_CONTRACT_ID = mainnet.contractId;

/** When the mainnet deployment was recorded; empty until there is one. */
export const MAINNET_ORACLE_DEPLOYED_AT = mainnet.deployedAt;

export type OracleNetwork = 'mainnet' | 'testnet';

/**
 * The network the app is configured for: `NEXT_PUBLIC_STELLAR_NETWORK`, with
 * anything other than `mainnet` (including unset and `futurenet`) read as
 * `testnet`, the only other network an oracle is deployed to.
 */
export function currentNetwork(): OracleNetwork {
  return process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
}

/**
 * The oracle address to use, in precedence order:
 *   1. an explicit argument (tests, scripts targeting another deployment)
 *   2. `ORACLE_CONTRACT_ID` (a redeploy that has not been committed yet)
 *   3. the deployment recorded for `network`
 *
 * Throws when the resolved mainnet address is empty: reading or publishing
 * against a mainnet oracle that does not exist yet must fail loudly rather than
 * quietly fall back to the testnet contract.
 */
export function resolveOracleContractId(
  explicit?: string,
  network: OracleNetwork = currentNetwork()
): string {
  const contractId =
    explicit ||
    process.env.ORACLE_CONTRACT_ID ||
    (network === 'mainnet' ? MAINNET_ORACLE_CONTRACT_ID : TESTNET_ORACLE_CONTRACT_ID);

  if (!contractId && network === 'mainnet') {
    throw new Error('No mainnet oracle deployment recorded in .deployments/mainnet.json');
  }
  return contractId;
}
