import { Pool } from 'pg';
import { runBatch, DEFAULT_BATCH_SIZE, type BatchConfig, type QueryExecutor } from './batch';
import { acquireLock, releaseLock } from './lock';

// Re-exported so consumers can `import { runBatch } from '@stellarintel/publisher'`
// and build their own BatchConfig (e.g. the main app's /api/publisher/tick route,
// which already has its own DB pool + lock) instead of shelling out to this CLI.
export { runBatch, DEFAULT_BATCH_SIZE, type BatchConfig, type QueryExecutor };

const LOCK_KEY = 'publisher-batch';
const LOCK_TTL_MS = 5 * 60 * 1_000;

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

async function buildExecutor(databaseUrl: string): Promise<QueryExecutor> {
  const pool = new Pool({ connectionString: databaseUrl });
  return (sql, params) => pool.query(sql, params as unknown[]);
}

async function main(): Promise<void> {
  if (!acquireLock(LOCK_KEY, LOCK_TTL_MS)) {
    // eslint-disable-next-line no-console
    console.warn('[publisher] Batch already in progress — skipping');
    process.exit(0);
  }

  try {
    const databaseUrl = requireEnv('DATABASE_URL');
    const executor = await buildExecutor(databaseUrl);

    const config: BatchConfig = {
      batchSize: process.env['BATCH_SIZE']
        ? parseInt(process.env['BATCH_SIZE'], 10)
        : DEFAULT_BATCH_SIZE,
      executor,
      oracleContractId: requireEnv('ORACLE_CONTRACT_ID'),
      networkPassphrase:
        process.env['STELLAR_NETWORK_PASSPHRASE'] ??
        (process.env['SOROBAN_RPC_URL']?.includes('testnet')
          ? 'Test SDF Network ; September 2015'
          : 'Public Global Stellar Network ; September 2015'),
      publisherSecret: requireEnv('PUBLISHER_SECRET'),
      horizonUrl: process.env['HORIZON_URL'] ?? 'https://horizon.stellar.org',
      rpcUrl: process.env['SOROBAN_RPC_URL'] ?? 'https://mainnet.sorobanrpc.com',
    };

    const result = await runBatch(config);
    // eslint-disable-next-line no-console
    console.log('[publisher] Batch complete:', result);
  } finally {
    releaseLock(LOCK_KEY);
  }
}

// Only auto-run as a CLI (not when imported as a library — see the re-exports
// above, used by the main app's /api/publisher/tick route).
const invokedDirectly =
  process.argv[1] !== undefined &&
  /packages[\\/]publisher[\\/](src|dist)[\\/]index\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[publisher] Fatal error:', err);
    process.exit(1);
  });
}
