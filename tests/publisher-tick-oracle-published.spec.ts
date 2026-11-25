import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  emitHealthChanges: vi.fn(),
  emitWebhookEvent: vi.fn(),
  runBatch: vi.fn(),
}));

vi.mock('@/lib/webhooks/health-diff', () => ({ emitHealthChanges: mocks.emitHealthChanges }));
vi.mock('@/lib/webhooks/emit', () => ({ emitWebhookEvent: mocks.emitWebhookEvent }));
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
  mocks.emitHealthChanges.mockReset().mockResolvedValue(0);
  mocks.emitWebhookEvent.mockReset();
  mocks.runBatch.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('publisher tick: oracle.published webhook (#2191)', () => {
  it('emits oracle.published once when a batch writes outcomes on-chain', async () => {
    mocks.runBatch.mockResolvedValue({
      submitted: 2,
      skipped: 0,
      txHash: 'abc',
    });

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.submitted).toBe(2);

    expect(mocks.emitWebhookEvent).toHaveBeenCalledTimes(1);
    const call = mocks.emitWebhookEvent.mock.calls[0]!;
    const [kind, payload, opts] = call;

    expect(kind).toBe('oracle.published');
    expect(payload.network).toBe('testnet');
    expect(payload.contractId).toBe('CTEST');
    expect(payload.txHash).toBe('abc');
    expect(payload.outcomesPublished).toBe(2);
    expect(payload.corridorRatesPublished).toBe(0);
    expect(payload.corridorMetricsPublished).toBe(0);
    expect(payload.probeSignalsPublished).toBe(0);
    expect(typeof payload.publishedAt).toBe('string');
    expect(opts?.idempotencyKey).toBe('oracle.published:abc');
  });

  it('emits nothing when gate is blocked', async () => {
    mocks.runBatch.mockResolvedValue({
      submitted: 5,
      skipped: 0,
      txHash: 'def',
      gate: { allowed: false, reason: 'unaccumulated' },
    });

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mocks.emitWebhookEvent).not.toHaveBeenCalled();
  });

  it('emits nothing when all counts are zero', async () => {
    mocks.runBatch.mockResolvedValue({
      submitted: 0,
      skipped: 3,
      corridorRatesPublished: 0,
      corridorMetricsPublished: 0,
      probeSignalsPublished: 0,
    });

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mocks.emitWebhookEvent).not.toHaveBeenCalled();
  });

  it('returns 200 tick even when emitWebhookEvent throws', async () => {
    mocks.runBatch.mockResolvedValue({
      submitted: 1,
      skipped: 0,
      txHash: 'err-hash',
    });
    mocks.emitWebhookEvent.mockImplementation(() => {
      throw new Error('webhook emit unexpected failure');
    });

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mocks.emitWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it('uses publishedAt for idempotencyKey when txHash is missing', async () => {
    mocks.runBatch.mockResolvedValue({
      submitted: 0,
      skipped: 0,
      corridorRatesPublished: 1,
    });

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mocks.emitWebhookEvent).toHaveBeenCalledTimes(1);

    const call = mocks.emitWebhookEvent.mock.calls[0]!;
    const [, payload, opts] = call;
    expect(payload.corridorRatesPublished).toBe(1);
    expect(payload.txHash).toBeNull();
    expect(opts?.idempotencyKey).toBe(`oracle.published:${payload.publishedAt}`);
  });
});
