import { NextRequest, NextResponse } from 'next/server';
import {
  runBatch,
  DEFAULT_BATCH_SIZE,
  type BatchConfig,
  type QueryExecutor,
} from '@stellarintel/publisher';
import { withLoggerContext } from '@/lib/logger';
import { acquireLock, releaseLock } from '@/lib/reputation/lock';
import { recordPublisherError, recordPublisherRun } from '@/lib/metrics';
import { getPool } from '@/lib/reputation/pool';

export const runtime = 'nodejs';
// Fluid Compute: allow the function to run for up to 5 minutes per tick so a
// large pending batch is not cut short by the default 10-second timeout.
export const maxDuration = 300;

const LOCK_KEY = 'publisher-tick';
const LOCK_TTL_MS = 5 * 60 * 1_000;

// Testnet only — mainnet oracle deployment is a separate roadmap gate (see
// docs/ORACLE_SPEC.md). These defaults match the recorded testnet deployment
// in .deployments/testnet.json; override via env for a redeploy.
const DEFAULT_ORACLE_CONTRACT_ID = 'CCZ54NTEOVL2DKWCGJA5XHTHOGRDS7JHFKYWEC6QH2IMZLYNM3FBFKDG';
const DEFAULT_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org';

// Shares the one process-wide pool with the reputation store rather than
// opening a second one (Issue #906). The publisher's `QueryExecutor` is a
// function while the store's `SqlExecutor` is an object, so this adapts shape
// only — the underlying connections are the same.
function getExecutor(): QueryExecutor {
  const activePool = getPool();
  return (sql, params) => activePool.query(sql, params as unknown[]);
}

async function tick(): Promise<{ submitted: number; skipped: number; txHash: string | null }> {
  const publisherSecret = process.env.PUBLISHER_SECRET;
  if (!publisherSecret) {
    throw new Error('PUBLISHER_SECRET is required for the publisher tick');
  }

  const config: BatchConfig = {
    batchSize: process.env.BATCH_SIZE ? parseInt(process.env.BATCH_SIZE, 10) : DEFAULT_BATCH_SIZE,
    executor: getExecutor(),
    oracleContractId: process.env.ORACLE_CONTRACT_ID ?? DEFAULT_ORACLE_CONTRACT_ID,
    networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE ?? DEFAULT_NETWORK_PASSPHRASE,
    publisherSecret,
    horizonUrl: process.env.HORIZON_URL ?? DEFAULT_HORIZON_URL,
    rpcUrl: process.env.SOROBAN_RPC_URL ?? DEFAULT_RPC_URL,
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
      logger.info({ event: 'publisher_tick_complete', ...result });
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
