import { createHash } from 'crypto';

export type QueryExecutor = (
  sql: string,
  params?: unknown[]
) => Promise<{ rows: Record<string, unknown>[] }>;

export interface BatchConfig {
  batchSize: number;
  executor: QueryExecutor;
  oracleContractId: string;
  networkPassphrase: string;
  publisherSecret: string;
  horizonUrl: string;
}

export const DEFAULT_BATCH_SIZE = 100;

export interface OutcomeRow {
  intentHash: string;
  anchorId: string;
  corridor: string;
  outcome: string;
  settleSeconds: number | null;
  quotedRate: string;
  deliveredRate: string | null;
}

export interface BatchResult {
  submitted: number;
  skipped: number;
  txHash: string | null;
}

export async function fetchPendingOutcomes(
  executor: QueryExecutor,
  limit: number
): Promise<OutcomeRow[]> {
  const { rows } = await executor(
    `SELECT
       intent_hash,
       anchor_id,
       corridor,
       outcome,
       settle_seconds,
       quoted_rate,
       delivered_rate
     FROM reputation_outcomes
     WHERE published_at IS NULL
       AND reconciled_at IS NOT NULL
     ORDER BY reconciled_at ASC
     LIMIT $1`,
    [limit]
  );

  return rows.map((r) => ({
    intentHash: r['intent_hash'] as string,
    anchorId: r['anchor_id'] as string,
    corridor: r['corridor'] as string,
    outcome: r['outcome'] as string,
    settleSeconds: r['settle_seconds'] != null ? Number(r['settle_seconds'] as string) : null,
    quotedRate: r['quoted_rate'] as string,
    deliveredRate: (r['delivered_rate'] as string | null) ?? null,
  }));
}

export async function markPublished(
  executor: QueryExecutor,
  intentHashes: string[],
  txHash: string
): Promise<void> {
  if (intentHashes.length === 0) return;
  const placeholders = intentHashes.map((_, i) => `$${i + 2}`).join(', ');
  await executor(
    `UPDATE reputation_outcomes
       SET published_at = NOW(), oracle_tx_hash = $1
     WHERE intent_hash IN (${placeholders})`,
    [txHash, ...intentHashes]
  );
}

export function buildOutcomeHash(row: OutcomeRow): string {
  const payload = [
    row.intentHash,
    row.anchorId,
    row.corridor,
    row.outcome,
    row.settleSeconds ?? '',
  ].join(':');
  return createHash('sha256').update(payload).digest('hex');
}

export async function submitToOracle(
  rows: OutcomeRow[],
  config: Pick<
    BatchConfig,
    'oracleContractId' | 'networkPassphrase' | 'publisherSecret' | 'horizonUrl'
  >
): Promise<string> {
  void rows;
  void config;
  throw new Error(
    `Oracle submission not yet wired (contract: ${config.oracleContractId}). ` +
      `Pending Wave 2.1 mainnet deployment.`
  );
}

export async function runBatch(config: BatchConfig): Promise<BatchResult> {
  const rows = await fetchPendingOutcomes(config.executor, config.batchSize);

  if (rows.length === 0) {
    return { submitted: 0, skipped: 0, txHash: null };
  }

  const txHash = await submitToOracle(rows, config);
  await markPublished(
    config.executor,
    rows.map((r) => r.intentHash),
    txHash
  );

  return { submitted: rows.length, skipped: 0, txHash };
}
