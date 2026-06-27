import { runBatch, DEFAULT_BATCH_SIZE, type BatchConfig, type QueryExecutor } from './batch';
import { acquireLock, releaseLock } from './lock';

const LOCK_KEY = 'publisher-batch';
const LOCK_TTL_MS = 5 * 60 * 1_000;

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

async function buildExecutor(databaseUrl: string): Promise<QueryExecutor> {
  // pg is a peer/runtime dependency provided by the deployment environment.
  // Dynamic require keeps it out of declared dependencies so the root lockfile
  // covers everything and the package stays zero-dep at build time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require('pg') as {
    Pool: new (opts: { connectionString: string }) => {
      query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    };
  };
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
        'Public Global Stellar Network ; September 2015',
      publisherSecret: requireEnv('PUBLISHER_SECRET'),
      horizonUrl: process.env['HORIZON_URL'] ?? 'https://horizon.stellar.org',
    };

    const result = await runBatch(config);
    // eslint-disable-next-line no-console
    console.log('[publisher] Batch complete:', result);
  } finally {
    releaseLock(LOCK_KEY);
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[publisher] Fatal error:', err);
  process.exit(1);
});
