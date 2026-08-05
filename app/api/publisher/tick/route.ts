import { NextRequest, NextResponse } from 'next/server';
import {
  runBatch,
  resolveNetwork,
  isOverrideEnabled,
  DEFAULT_BATCH_SIZE,
  type BatchConfig,
  type BatchResult,
  type QueryExecutor,
  type ProbeCoverageSummary,
} from '@stellarintel/publisher';
import { withLoggerContext } from '@/lib/logger';
import { acquireLock, releaseLock } from '@/lib/reputation/lock';
import { recordPublisherError, recordPublisherRun } from '@/lib/metrics';
import { getPool } from '@/lib/reputation/pool';
import { getReputationStore } from '@/lib/reputation/store';
import { loadProbeCoverageReport } from '@/lib/reputation/probeCoverage';
import { resolveOracleContractId, TESTNET_ORACLE_CONTRACT_ID } from '@/lib/oracle/deployment';

export const runtime = 'nodejs';
// Fluid Compute: allow the function to run for up to 5 minutes per tick so a
// large pending batch is not cut short by the default 10-second timeout.
export const maxDuration = 300;

const LOCK_KEY = 'publisher-tick';
const LOCK_TTL_MS = 5 * 60 * 1_000;

// Shares the one process-wide pool with the reputation store rather than
// opening a second one (Issue #906). The publisher's `QueryExecutor` is a
// function while the store's `SqlExecutor` is an object, so this adapts shape
// only — the underlying connections are the same.
function getExecutor(): QueryExecutor {
  const activePool = getPool();
  return (sql, params) => activePool.query(sql, params as unknown[]);
}

/**
 * Probe coverage for the gate, or `null` when it cannot be read.
 *
 * `null` is a refusal on mainnet, so a store that is down fails closed rather
 * than publishing against an unknown probe history. On testnet the gate never
 * consults this, so a missing store there is not an error.
 */
async function loadCoverage(): Promise<ProbeCoverageSummary | null> {
  try {
    return await loadProbeCoverageReport(getReputationStore());
  } catch {
    return null;
  }
}

async function tick(): Promise<BatchResult> {
  const publisherSecret = process.env.PUBLISHER_SECRET;
  if (!publisherSecret) {
    throw new Error('PUBLISHER_SECRET is required for the publisher tick');
  }

  // Was three hardcoded testnet defaults here, while the CLI defaulted to
  // mainnet from the same env — the split #912 fixed everywhere except this
  // route. resolveNetwork throws when STELLAR_NETWORK is unset, which is the
  // point: the gate below cannot be trusted while a caller guesses the network.
  const network = resolveNetwork();

  const config: BatchConfig = {
    batchSize: process.env.BATCH_SIZE ? parseInt(process.env.BATCH_SIZE, 10) : DEFAULT_BATCH_SIZE,
    executor: getExecutor(),
    oracleContractId: resolveOracleContractId(),
    networkPassphrase: network.networkPassphrase,
    publisherSecret,
    horizonUrl: network.horizonUrl,
    rpcUrl: network.rpcUrl,
    gate: {
      network: network.network,
      loadCoverage,
      overrideEnabled: isOverrideEnabled(),
      contractId: resolveOracleContractId(),
      testnetContractId: TESTNET_ORACLE_CONTRACT_ID,
    },
  };

  return runBatch(config);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return withLoggerContext('api.publisher.tick', async (logger) => {
    if (!(await acquireLock(LOCK_KEY, LOCK_TTL_MS))) {
      logger.warn({ event: 'publisher_tick_conflict' });
      return NextResponse.json({ error: 'Publisher tick already in progress' }, { status: 409 });
    }

    try {
      const result = await tick();
      // Actually record the run. These recorders existed but had zero call
      // sites, which is why /api/publisher/health always reported "never ran"
      // (#910).
      recordPublisherRun(result.submitted);

      // A closed gate returns 200, not 4xx (#786). The cron calls this every 5
      // minutes with `curl -f`, so a 4xx during a legitimate 90-day
      // accumulation window would file a publisher alert 288 times a day for
      // three months — which is exactly how people learn to ignore publisher
      // alerts. A withheld batch is the gate working, not an incident. The CLI
      // exits non-zero for the operator-facing case.
      if (result.gate && !result.gate.allowed) {
        logger.warn({
          event: 'publish_gate_blocked',
          reason: result.gate.reason,
          thresholdDays: result.gate.thresholdDays,
          skipped: result.skipped,
          shortfall: result.gate.shortfall,
        });
      } else {
        logger.info({ event: 'publisher_tick_complete', ...result });
      }

      return NextResponse.json({ ok: true, ...result, tickedAt: new Date().toISOString() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordPublisherError(message);
      logger.error({
        event: 'publisher_tick_failed',
        error: message,
      });
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Publisher tick failed' },
        { status: 500 }
      );
    } finally {
      await releaseLock(LOCK_KEY);
    }
  });
}

export const POST = GET;
