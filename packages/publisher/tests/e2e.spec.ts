/**
 * Publisher end-to-end against testnet (issue #355).
 *
 * Exercises the full path: a settlement outcome written to Postgres → the
 * publisher tick → a Soroban write → an on-chain read. The round trip must
 * complete under 30s and be idempotent (a second tick must not duplicate the
 * on-chain entry).
 *
 * This is an opt-in integration test. It runs only when a testnet environment
 * is fully provisioned; otherwise the suite is skipped, so it never touches the
 * network during ordinary `npm test`. Provide:
 *
 *   PUBLISHER_RPC_URL              Soroban RPC endpoint (testnet)
 *   PUBLISHER_CONTRACT_ID          deployed reputation contract id
 *   PUBLISHER_SECRET_KEY           funded source/publisher secret (S...)
 *   PUBLISHER_NETWORK_PASSPHRASE   e.g. "Test SDF Network ; September 2015"
 *   PUBLISHER_TICK_URL             URL of the publisher tick endpoint
 *   DATABASE_URL                   Postgres connection string
 *   CRON_SECRET                    bearer secret the tick endpoint expects
 *
 * Optional: PUBLISHER_PG_MODULE (driver module, default "pg").
 */

import { describe, it, expect } from 'vitest';
import type { OutcomeLogRow } from '@/types/reputation';
import type { ReputationStore } from '@/lib/reputation/store';
import type { SqlExecutor } from '@/lib/reputation/postgres';

const REQUIRED_ENV = [
  'PUBLISHER_RPC_URL',
  'PUBLISHER_CONTRACT_ID',
  'PUBLISHER_SECRET_KEY',
  'PUBLISHER_NETWORK_PASSPHRASE',
  'PUBLISHER_TICK_URL',
  'DATABASE_URL',
  'CRON_SECRET',
] as const;

const READY = REQUIRED_ENV.every((key) => Boolean(process.env[key]));

interface Config {
  rpcUrl: string;
  contractId: string;
  secretKey: string;
  networkPassphrase: string;
  tickUrl: string;
  databaseUrl: string;
  cronSecret: string;
  pgModule: string;
  readLimit: number;
  pollIntervalMs: number;
  maxRoundTripMs: number;
}

function readConfig(): Config {
  return {
    rpcUrl: process.env.PUBLISHER_RPC_URL as string,
    contractId: process.env.PUBLISHER_CONTRACT_ID as string,
    secretKey: process.env.PUBLISHER_SECRET_KEY as string,
    networkPassphrase: process.env.PUBLISHER_NETWORK_PASSPHRASE as string,
    tickUrl: process.env.PUBLISHER_TICK_URL as string,
    databaseUrl: process.env.DATABASE_URL as string,
    cronSecret: process.env.CRON_SECRET as string,
    pgModule: process.env.PUBLISHER_PG_MODULE ?? 'pg',
    readLimit: 100,
    pollIntervalMs: 1_500,
    maxRoundTripMs: 30_000,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Seed a pending settlement outcome into Postgres and return the open store. */
async function seedPostgresOutcome(
  cfg: Config,
  anchorId: string,
  intentHash: string
): Promise<ReputationStore> {
  // Non-literal specifier: the driver stays an optional, runtime-only dependency
  // that only the provisioned e2e environment needs.
  const driver: any = await import(cfg.pgModule);
  const Pool = driver.Pool ?? driver.default?.Pool;
  const pool = new Pool({ connectionString: cfg.databaseUrl });
  const executor: SqlExecutor = {
    query: (text, params) => pool.query(text, params),
  };

  const { createReputationStore } = await import('@/lib/reputation/store');
  const store = createReputationStore({ backend: 'postgres', executor });

  const row: OutcomeLogRow = {
    intentHash,
    anchorId,
    corridor: 'USD-NGN',
    quotedRate: '1500.0',
    deliveredRate: null,
    quotedAmount: '100.0',
    deliveredAmount: null,
    settleSeconds: 42,
    outcome: 'completed',
    createdAt: new Date().toISOString(),
    stellarTransactionId: null,
    reconciledAt: null,
  };
  await store.append(row);
  return store;
}

/** Drive the publisher: read pending Postgres rows and write them to Soroban. */
async function triggerPublisher(cfg: Config): Promise<void> {
  const res = await fetch(cfg.tickUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.cronSecret}` },
  });
  // 200 = ticked; 409 = a concurrent tick already holds the lock — both are fine.
  if (!res.ok && res.status !== 409) {
    throw new Error(`publisher tick failed: ${res.status} ${await res.text()}`);
  }
}

/** Read `recent_outcomes(anchorId)` from chain and count entries for `intentHash`. */
async function countOnChain(
  sdk: any,
  server: any,
  contract: any,
  cfg: Config,
  anchorId: string,
  intentHash: string
): Promise<number> {
  const account = await server.getAccount(sdk.Keypair.fromSecret(cfg.secretKey).publicKey());
  const tx = new sdk.TransactionBuilder(account, {
    fee: sdk.BASE_FEE,
    networkPassphrase: cfg.networkPassphrase,
  })
    .addOperation(
      contract.call(
        'recent_outcomes',
        sdk.nativeToScVal(anchorId, { type: 'string' }),
        sdk.nativeToScVal(cfg.readLimit, { type: 'u32' })
      )
    )
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  const retval = sim?.result?.retval;
  if (!retval) return 0;

  const outcomes = sdk.scValToNative(retval) as Array<[string, unknown, unknown]>;
  return outcomes.filter((entry) => entry[0] === intentHash).length;
}

describe.skipIf(!READY)('publisher e2e (testnet)', () => {
  it('round-trips a Postgres outcome to chain and back, idempotently', async () => {
    const sdk: any = await import('@stellar/stellar-sdk');
    const cfg = readConfig();

    const server = new sdk.rpc.Server(cfg.rpcUrl, {
      allowHttp: cfg.rpcUrl.startsWith('http://'),
    });
    const contract = new sdk.Contract(cfg.contractId);

    // Unique ids isolate this run from any pre-existing on-chain state.
    const runId = crypto.randomUUID();
    const anchorId = `e2e-anchor-${runId}`;
    const intentHash = `e2e-intent-${runId}`;

    const store = await seedPostgresOutcome(cfg, anchorId, intentHash);
    try {
      const startedAt = Date.now();
      await triggerPublisher(cfg);

      // Poll the chain until the outcome lands or the round-trip budget elapses.
      const deadline = startedAt + cfg.maxRoundTripMs;
      let onChain = 0;
      while (Date.now() < deadline) {
        onChain = await countOnChain(sdk, server, contract, cfg, anchorId, intentHash);
        if (onChain > 0) break;
        await sleep(cfg.pollIntervalMs);
      }
      const elapsedMs = Date.now() - startedAt;

      expect(onChain, 'outcome never appeared on-chain within budget').toBeGreaterThan(0);
      expect(elapsedMs).toBeLessThan(cfg.maxRoundTripMs);

      // Idempotency: a second tick must not duplicate the on-chain entry.
      const before = onChain;
      await triggerPublisher(cfg);
      await sleep(cfg.pollIntervalMs * 2);
      const after = await countOnChain(sdk, server, contract, cfg, anchorId, intentHash);
      expect(after).toBe(before);
    } finally {
      await store.close();
    }
  }, 60_000);
});
