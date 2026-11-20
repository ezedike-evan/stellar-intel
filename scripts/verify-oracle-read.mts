/**
 * Live oracle read check (#723, network-aware since #1406).
 *
 * Reads the deployed reputation contract over Soroban RPC and prints what came
 * back. Intended to run warn-only on a schedule: a third-party network being
 * unreachable is not a repository defect, so this never fails the caller unless
 * `--strict` is passed.
 *
 *   npx tsx scripts/verify-oracle-read.mts                      # warn-only
 *   npx tsx scripts/verify-oracle-read.mts --strict             # exit 1 on failure
 *   npx tsx scripts/verify-oracle-read.mts --network mainnet    # verify mainnet
 *   npx tsx scripts/verify-oracle-read.mts --corridor usdc-kes
 *
 * The network is `--network`, else NEXT_PUBLIC_STELLAR_NETWORK, else testnet. It
 * decides which recorded deployment (.deployments/<network>.json) and which RPC
 * and passphrase are read. With `--network mainnet` and no mainnet deployment
 * recorded the script reports an error and exits 1 even without `--strict`:
 * a mainnet check that quietly checked testnet would be worse than none.
 */

// Deliberately does not import from constants/: that pulls lib/config.ts, which
// validates the app's NEXT_PUBLIC_* env at import time. This script only needs a
// corridor id, and a read-only contract check should not require the whole app's
// configuration to be present.
import {
  listAnchors,
  getCorridorAggregate,
  getScoreForCorridor,
  getOracleGovernance,
  resolveReadDefaults,
  type OracleReadConfig,
} from '../lib/oracle/read.js';
import {
  MAINNET_ORACLE_DEPLOYED_AT,
  TESTNET_ORACLE_DEPLOYED_AT,
  resolveOracleContractId,
} from '../lib/oracle/deployment.js';
import { parseVerifyArgs } from './lib/oracle-verify.js';

const { strict, network, corridor } = parseVerifyArgs(process.argv.slice(2));

function fail(message: string): void {
  console.error(`::${strict ? 'error' : 'warning'}::${message}`);
  if (strict) process.exitCode = 1;
}

async function main(): Promise<void> {
  let contractId: string;
  try {
    contractId = resolveOracleContractId(undefined, network);
  } catch (err) {
    // Always an error, strict or not: an unverifiable mainnet must not read as ok.
    console.error(`::error::${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  // Point every read at the chosen network, not at whatever the environment says.
  const config: OracleReadConfig = { contractId, ...resolveReadDefaults(network) };

  console.log(`Network         : ${network}`);
  console.log(`Oracle contract : ${contractId}`);
  console.log(
    `Deployed at     : ${
      (network === 'mainnet' ? MAINNET_ORACLE_DEPLOYED_AT : TESTNET_ORACLE_DEPLOYED_AT) ||
      '(not recorded)'
    }`
  );

  // Custody first: who controls this contract is the question a mainnet
  // pre-flight actually needs answered (#913).
  try {
    const gov = await getOracleGovernance(config);
    console.log(`Contract version: ${gov.contractVersion}`);
    console.log(`Admin           : ${gov.admin ?? '(unset)'}`);
    console.log(`Upgrade admin   : ${gov.upgradeAdmin ?? '(unset)'}`);
    if (gov.pendingAdmin) {
      console.log(`Pending admin   : ${gov.pendingAdmin}`);
    }
    if (gov.missingEntrypoints.length > 0) {
      // The deployed bytecode is older than this repo's source. Worth shouting
      // about: it means fixes that look merged are not actually live.
      console.log(
        `::warning::Deployed contract is missing ${gov.missingEntrypoints.join(', ')} — ` +
          'the on-chain bytecode predates the current source. Re-deploy before ' +
          'relying on anything added since.'
      );
    }
    if (!gov.authoritiesSeparated) {
      console.log(
        '::warning::Operational admin and upgrade admin are not two distinct accounts. ' +
          'One compromised key can both forge data and replace the contract code.'
      );
    }
    // contract_version() returns 0 when init_upgrade was never called, which
    // means upgrade::apply would panic — there is no in-place upgrade path from
    // what is deployed, only a fresh deploy. Worth calling out separately from
    // the missing-entrypoint warning above: a contract can carry every
    // entrypoint and still be unupgradeable (#872, #785).
    if (gov.contractVersion === 0) {
      console.log(
        '::warning::contract_version() is 0 — the deployed bytecode predates the ' +
          'constructor-based __constructor(admin, upgrade_admin) that binds both ' +
          'authorities at deploy time, so upgrade() would panic. There is no ' +
          'in-place fix; only a fresh deploy sets this. See docs/ORACLE_SPEC.md ' +
          '§ "Fresh deploy".'
      );
    }
  } catch (err) {
    fail(`governance read failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let anchors: string[];
  try {
    anchors = await listAnchors(config);
  } catch (err) {
    fail(`list_anchors failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  console.log(`Registered anchors (${anchors.length}): ${anchors.join(', ') || '(none)'}`);

  if (anchors.length === 0) {
    // Not an error: a freshly deployed contract has an empty registry until
    // scripts/init-oracle-registry.ts runs. Reporting it is the point.
    console.log('::notice::Contract is reachable but no anchors are registered yet.');
    return;
  }

  for (const anchorId of anchors) {
    try {
      const aggregate = await getCorridorAggregate(anchorId, corridor, config);
      const score = await getScoreForCorridor(anchorId, corridor, config);

      // Both read helpers return null when the contract has no data for the
      // pair, rather than a zeroed tuple that reads as a real score (#723).
      if (aggregate === null && score === null) {
        console.log(`${anchorId} / ${corridor}: no on-chain data yet`);
        continue;
      }

      console.log(
        `${anchorId} / ${corridor}: ` +
          `total=${aggregate?.total ?? '-'} successes=${aggregate?.successes ?? '-'} ` +
          `composite=${score ? `${score.compositeBps}bps` : '-'} n=${score?.n ?? 0}`
      );
    } catch (err) {
      fail(
        `read for ${anchorId}/${corridor} failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

main().catch((err: unknown) => {
  fail(`Unexpected failure: ${err instanceof Error ? err.message : String(err)}`);
});
