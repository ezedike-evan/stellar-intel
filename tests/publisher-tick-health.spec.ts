/**
 * The publisher tick tells webhook subscribers about anchor health changes (#1342).
 * The route is exercised with its collaborators mocked: what matters here is that the
 * health emit runs, runs before the batch, and can never fail or skip the tick.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  emitHealthChanges: vi.fn(),
  runBatch: vi.fn(),
  order: [] as string[],
}));

vi.mock('@/lib/webhooks/health-diff', () => ({ emitHealthChanges: mocks.emitHealthChanges }));
vi.mock('@stellarintel/publisher', () => ({
  runBatch: mocks.runBatch,
  resolveNetwork: () => ({
    network: 'testnet',
    networkPassphrase: 'Test SDF Network ; September 2015',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    rpcUrl: 'https://soroban-testnet.stellar.org',
  }),
  isOverrideEnabled: () => false,
  DEFAULT_BATCH_SIZE: 10,
}));
vi.mock('@/lib/api/cron-auth', () => ({ checkCronAuth: () => null }));
vi.mock('@/lib/api/store-guard', () => ({ checkDurableStore: () => null }));
vi.mock('@/lib/reputation/lock', () => ({
  acquireLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/metrics', () => ({ recordPublisherRun: vi.fn(), recordPublisherError: vi.fn() }));
vi.mock('@/lib/reputation/pool', () => ({ getPool: () => ({ query: vi.fn() }) }));
vi.mock('@/lib/reputation/store', () => ({ getReputationStore: () => ({}) }));
vi.mock('@/lib/reputation/probeCoverage', () => ({ loadProbeCoverageReport: vi.fn() }));
vi.mock('@/lib/oracle/deployment', () => ({
  resolveOracleContractId: () => 'CTEST',
  TESTNET_ORACLE_CONTRACT_ID: 'CTEST',
}));

import { GET } from '@/app/api/publisher/tick/route';

const request = () => new NextRequest('http://localhost/api/publisher/tick');

beforeEach(() => {
  vi.stubEnv('PUBLISHER_SECRET', 'SCTEST');
  mocks.order.length = 0;
  mocks.emitHealthChanges.mockReset();
  mocks.emitHealthChanges.mockImplementation(async () => {
    mocks.order.push('health');
    return 0;
  });
  mocks.runBatch.mockReset();
  mocks.runBatch.mockImplementation(async () => {
    mocks.order.push('batch');
    return { submitted: 0, skipped: 0 };
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('publisher tick: anchor health webhooks (#1342)', () => {
  it('emits health changes once, before the batch runs', async () => {
    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(mocks.emitHealthChanges).toHaveBeenCalledTimes(1);
    expect(mocks.order).toEqual(['health', 'batch']);
  });

  it('still runs the batch and answers 200 when the health emit fails', async () => {
    mocks.emitHealthChanges.mockRejectedValue(new Error('snapshot table missing'));

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mocks.runBatch).toHaveBeenCalledTimes(1);
  });

  it('emits health changes even when the batch then fails', async () => {
    mocks.runBatch.mockRejectedValue(new Error('rpc down'));

    const res = await GET(request());

    expect(res.status).toBe(500);
    expect(mocks.emitHealthChanges).toHaveBeenCalledTimes(1);
  });
});
