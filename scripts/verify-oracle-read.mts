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
import { listAnchors, getCorridorAggregate, getScoreForCorridor } from '../lib/oracle/read.js';
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
