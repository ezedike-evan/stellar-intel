import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildOutcomeHash,
  classifyError,
  fetchPendingOutcomes,
  markPublished,
  runBatch,
  submitToOracle,
  withRetry,
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
  rpcUrl: 'https://soroban-testnet.stellar.org',
};

// Hoisted so individual tests can reconfigure the mocked contract-write (e.g.
// to reject once and then succeed) while the default keeps the happy path.
const sdkMocks = vi.hoisted(() => ({
  submitOutcome: vi.fn(),
  signAndSend: vi.fn(),
}));

vi.mock('@stellar/stellar-sdk', () => ({
  Keypair: {
    fromSecret: vi.fn().mockReturnValue({ publicKey: () => 'GPUBLISHERMOCK' }),
  },
  contract: {
    basicNodeSigner: vi.fn().mockReturnValue({ signTransaction: vi.fn() }),
    Client: { from: vi.fn().mockResolvedValue({ submit_outcome: sdkMocks.submitOutcome }) },
  },
}));

beforeEach(() => {
  sdkMocks.signAndSend.mockReset().mockResolvedValue({
    sendTransactionResponse: { hash: 'mock-tx-hash' },
  });
  sdkMocks.submitOutcome.mockReset().mockResolvedValue({ signAndSend: sdkMocks.signAndSend });
});

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

  it('submits pending rows to the oracle and marks them published', async () => {
    const executor = makeExecutor([dbRow(SAMPLE_ROW)]);
    const config = { ...BASE_CONFIG, executor };
    const result = await runBatch(config);
    expect(result).toEqual({ submitted: 1, skipped: 0, txHash: 'mock-tx-hash' });
    expect(executor).toHaveBeenCalledWith(expect.stringContaining('UPDATE'), [
      'mock-tx-hash',
      SAMPLE_ROW.intentHash,
    ]);
  });
});

describe('classifyError', () => {
  it('treats timeouts, 5xx, rate limits, and sequence races as retryable', () => {
    expect(classifyError(new Error('request timed out'))).toBe('retryable');
    expect(classifyError({ status: 503, message: 'Service Unavailable' })).toBe('retryable');
    expect(classifyError({ status: 429, message: 'Too Many Requests' })).toBe('retryable');
    expect(
      classifyError({
        message: 'transaction submission failed',
        response: { data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } } },
      })
    ).toBe('retryable');
  });

  it('treats malformed batches and contract rejections as non-retryable', () => {
    expect(classifyError({ status: 400, message: 'tx_malformed' })).toBe('non_retryable');
    expect(classifyError(new Error('HostError: contract logic rejected the invocation'))).toBe(
      'non_retryable'
    );
  });

  it('treats unknown failures as non-retryable so we fail fast and alert', () => {
    expect(classifyError(new Error('something unexpected'))).toBe('non_retryable');
  });
});

describe('withRetry', () => {
  const fast = { baseDelayMs: 1, maxDelayMs: 2 };

  // Acceptance criteria: a simulated transient failure retries and succeeds.
  it('retries a transient failure and eventually succeeds without alerting', async () => {
    const onAlert = vi.fn();
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('ETIMEDOUT');
      return 'ok';
    });

    const result = await withRetry(fn, { onAlert, options: fast });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onAlert).not.toHaveBeenCalled();
  });

  // Acceptance criteria: a simulated non-retryable failure fails immediately.
  it('fails immediately on a non-retryable error and alerts once', async () => {
    const onAlert = vi.fn();
    const fn = vi.fn(async () => {
      throw new Error('HostError: contract logic rejected');
    });

    await expect(withRetry(fn, { onAlert, options: fast })).rejects.toThrow('contract logic');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(onAlert).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'non_retryable', attempts: 1 })
    );
  });

  it('alerts and rethrows once the retry budget is exhausted', async () => {
    const onAlert = vi.fn();
    const fn = vi.fn(async () => {
      throw new Error('socket hang up');
    });

    await expect(withRetry(fn, { onAlert, options: { ...fast, maxAttempts: 3 } })).rejects.toThrow(
      'socket hang up'
    );

    expect(fn).toHaveBeenCalledTimes(3);
    expect(onAlert).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'retries_exhausted', attempts: 3 })
    );
  });
});

describe('submitToOracle retry wiring', () => {
  const writeConfig = {
    oracleContractId: BASE_CONFIG.oracleContractId,
    networkPassphrase: BASE_CONFIG.networkPassphrase,
    publisherSecret: BASE_CONFIG.publisherSecret,
    rpcUrl: BASE_CONFIG.rpcUrl,
  };

  it('retries a transient contract-write failure and eventually succeeds', async () => {
    sdkMocks.submitOutcome.mockRejectedValueOnce(new Error('fetch failed'));
    const onAlert = vi.fn();

    const txHash = await submitToOracle([SAMPLE_ROW], {
      ...writeConfig,
      onAlert,
      retry: { baseDelayMs: 1, maxDelayMs: 2 },
    });

    expect(txHash).toBe('mock-tx-hash');
    expect(sdkMocks.submitOutcome).toHaveBeenCalledTimes(2);
    expect(onAlert).not.toHaveBeenCalled();
  });

  it('fails fast and alerts on a non-retryable contract rejection', async () => {
    sdkMocks.submitOutcome.mockRejectedValue(new Error('HostError: contract logic rejected'));
    const onAlert = vi.fn();

    await expect(submitToOracle([SAMPLE_ROW], { ...writeConfig, onAlert })).rejects.toThrow(
      'contract logic'
    );

    expect(sdkMocks.submitOutcome).toHaveBeenCalledTimes(1);
    expect(onAlert).toHaveBeenCalledTimes(1);
  });
});
