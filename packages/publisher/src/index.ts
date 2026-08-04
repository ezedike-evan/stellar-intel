import { Pool } from 'pg';
import { runBatch, DEFAULT_BATCH_SIZE, type BatchConfig, type QueryExecutor } from './batch';
import { acquireLock, releaseLock } from './lock';
import { resolveNetwork } from './network';

// Re-exported so consumers can `import { runBatch } from '@stellarintel/publisher'`
// and build their own BatchConfig (e.g. the main app's /api/publisher/tick route,
// which already has its own DB pool + lock) instead of shelling out to this CLI.
export { runBatch, DEFAULT_BATCH_SIZE, type BatchConfig, type QueryExecutor };
export {
  resolveNetwork,
  isStellarNetwork,
  type NetworkConfig,
  type StellarNetwork,
} from './network';

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

    // Throws unless STELLAR_NETWORK names a network. Previously an unset
    // passphrase silently meant mainnet — see network.ts.
    const network = resolveNetwork();

    const config: BatchConfig = {
      batchSize: process.env['BATCH_SIZE']
        ? parseInt(process.env['BATCH_SIZE'], 10)
        : DEFAULT_BATCH_SIZE,
      executor,
      oracleContractId: requireEnv('ORACLE_CONTRACT_ID'),
      networkPassphrase: network.networkPassphrase,
      publisherSecret: requireEnv('PUBLISHER_SECRET'),
      horizonUrl: network.horizonUrl,
      rpcUrl: network.rpcUrl,
    };

    // Say which network out loud before signing anything, so an operator sees
    // it in the log rather than inferring it from an RPC hostname.
    // eslint-disable-next-line no-console
    console.log(`[publisher] Network: ${network.network} (${network.rpcUrl})`);

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
