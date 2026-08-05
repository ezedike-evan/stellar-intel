/**
 * Live testnet oracle read check (#723).
 *
 * Reads the deployed reputation contract over Soroban RPC and prints what came
 * back. Intended to run warn-only on a schedule: a third-party network being
 * unreachable is not a repository defect, so this never fails the caller unless
 * `--strict` is passed.
 *
 *   npx tsx scripts/verify-oracle-read.mts            # warn-only
 *   npx tsx scripts/verify-oracle-read.mts --strict   # exit 1 on failure
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
} from '../lib/oracle/read.js';
import {
  TESTNET_ORACLE_CONTRACT_ID,
  TESTNET_ORACLE_DEPLOYED_AT,
} from '../lib/oracle/deployment.js';

const strict = process.argv.includes('--strict');

/** Corridor to sample. Override with `--corridor <id>`. */
const corridorArgIndex = process.argv.indexOf('--corridor');
const corridor =
  corridorArgIndex !== -1 ? (process.argv[corridorArgIndex + 1] ?? 'usdc-ngn') : 'usdc-ngn';

function fail(message: string): void {
  console.error(`::${strict ? 'error' : 'warning'}::${message}`);
  if (strict) process.exitCode = 1;
}

async function main(): Promise<void> {
  console.log(`Oracle contract : ${TESTNET_ORACLE_CONTRACT_ID}`);
  console.log(`Deployed at     : ${TESTNET_ORACLE_DEPLOYED_AT}`);

  // Custody first: who controls this contract is the question a mainnet
  // pre-flight actually needs answered (#913).
  try {
    const gov = await getOracleGovernance();
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
        '::warning::contract_version() is 0 — init_upgrade was never called, so ' +
          'upgrade() would panic. Any new entrypoint requires a fresh deploy, not ' +
          'an in-place upgrade. See docs/ORACLE_MIGRATION.md.'
      );
    }
  } catch (err) {
    fail(`governance read failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let anchors: string[];
  try {
    anchors = await listAnchors();
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
      const aggregate = await getCorridorAggregate(anchorId, corridor);
      const score = await getScoreForCorridor(anchorId, corridor);

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
