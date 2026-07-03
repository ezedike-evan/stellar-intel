import { describe, it, expect, vi } from 'vitest';
import {
  buildOutcomeHash,
  fetchPendingOutcomes,
  markPublished,
  runBatch,
  type BatchConfig,
  type OutcomeRow,
  type QueryExecutor,
} from '../src/batch';

const SAMPLE_ROW: OutcomeRow = {
  intentHash: 'abc123',
  anchorId: 'test-anchor',
  corridor: 'usdc-ngn',
  outcome: 'completed',
  settleSeconds: 120,
  quotedRate: '1550.00',
  deliveredRate: '1548.50',
};

function dbRow(row: OutcomeRow): Record<string, unknown> {
  return {
    intent_hash: row.intentHash,
    anchor_id: row.anchorId,
    corridor: row.corridor,
    outcome: row.outcome,
    settle_seconds: row.settleSeconds != null ? String(row.settleSeconds) : null,
    quoted_rate: row.quotedRate,
    delivered_rate: row.deliveredRate,
  };
}

function makeExecutor(rows: Record<string, unknown>[]): QueryExecutor {
  return vi.fn().mockResolvedValue({ rows });
}

const BASE_CONFIG: BatchConfig = {
  batchSize: 10,
  executor: makeExecutor([]),
  oracleContractId: 'CABC123TEST',
  networkPassphrase: 'Test SDF Network ; September 2015',
  publisherSecret: 'STEST000000000000000000000000000000000000000000000000000000',
  horizonUrl: 'https://horizon-testnet.stellar.org',
};

describe('buildOutcomeHash', () => {
  it('produces a 64-char hex string', () => {
    const hash = buildOutcomeHash(SAMPLE_ROW);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic for the same input', () => {
    expect(buildOutcomeHash(SAMPLE_ROW)).toBe(buildOutcomeHash(SAMPLE_ROW));
  });

  it('differs when outcome changes', () => {
    const failed = { ...SAMPLE_ROW, outcome: 'error' };
    expect(buildOutcomeHash(SAMPLE_ROW)).not.toBe(buildOutcomeHash(failed));
  });
});

describe('fetchPendingOutcomes', () => {
  it('returns empty array when no rows pending', async () => {
    const executor = makeExecutor([]);
    const result = await fetchPendingOutcomes(executor, 10);
    expect(result).toEqual([]);
  });

  it('maps snake_case DB columns to camelCase', async () => {
    const executor = makeExecutor([dbRow(SAMPLE_ROW)]);
    const [row] = await fetchPendingOutcomes(executor, 10);
    expect(row).toEqual(SAMPLE_ROW);
  });

  it('passes the limit as a query parameter', async () => {
    const executor = makeExecutor([]);
    await fetchPendingOutcomes(executor, 25);
    expect(executor).toHaveBeenCalledWith(expect.any(String), [25]);
  });
});

describe('markPublished', () => {
  it('does nothing when intentHashes is empty', async () => {
    const executor = makeExecutor([]);
    await markPublished(executor, [], 'some-tx-hash');
    expect(executor).not.toHaveBeenCalled();
  });

  it('calls executor with correct placeholders', async () => {
    const executor = makeExecutor([]);
    await markPublished(executor, ['hash1', 'hash2'], 'tx-abc');
    expect(executor).toHaveBeenCalledWith(expect.stringContaining('$2, $3'), [
      'tx-abc',
      'hash1',
      'hash2',
    ]);
  });
});

describe('runBatch', () => {
  it('returns zero counts and null txHash when nothing is pending', async () => {
    const config = { ...BASE_CONFIG, executor: makeExecutor([]) };
    const result = await runBatch(config);
    expect(result).toEqual({ submitted: 0, skipped: 0, txHash: null });
  });

  it('throws when oracle submission is called with pending rows', async () => {
    const config = { ...BASE_CONFIG, executor: makeExecutor([dbRow(SAMPLE_ROW)]) };
    await expect(runBatch(config)).rejects.toThrow('Oracle submission not yet wired');
  });
});
