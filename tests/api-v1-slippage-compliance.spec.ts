import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/v1/slippage-compliance/route';
import {
  computeSlippageCompliance,
  type SlippageCompliance,
} from '@/lib/reputation/slippage-compliance';
import {
  InMemoryReputationStore,
  _setReputationStore,
  createReputationStore,
} from '@/lib/reputation/store';
import {
  InMemorySlippageBreachStore,
  _setSlippageBreachStore,
  _resetSlippageBreachStore,
} from '@/lib/reputation/slippage-breaches';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import type { OutcomeLogRow, SlippageBreach, SlippageEvidence } from '@/types/reputation';

function createEvidence(intentHash: string, overrides: Partial<SlippageEvidence> = {}): SlippageEvidence {
  return {
    v: 1,
    networkPassphrase: 'Test SDF Network ; September 2015',
    intentHash,
    anchorId: 'cowrie',
    corridor: 'usdc-ngn',
    signerAccount: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    minReceive: '1000.00',
    anchorReported: {
      anchorTransactionId: 'tx-123',
      amountOut: '950.00',
      reportedBy: 'sender',
    },
    shortfall: '50.00',
    shortfallBps: 500,
    onChain: null,
    detectedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createBreach(intentHash: string, overrides: Partial<SlippageBreach> = {}): SlippageBreach {
  const evidence = createEvidence(intentHash, overrides.evidence);
  return {
    intentHash,
    anchorId: 'cowrie',
    corridor: 'usdc-ngn',
    signerAccount: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    minReceive: '1000.00',
    amountOut: '950.00',
    shortfall: '50.00',
    shortfallBps: 500,
    stellarTransactionId: 'stellar-tx-abc',
    anchorTransactionId: 'tx-123',
    status: 'detected',
    rejectionReason: null,
    evidence,
    evidenceHash: '0'.repeat(64),
    detectedAt: new Date().toISOString(),
    verifiedAt: null,
    ...overrides,
  };
}

function createOutcomeRow(intentHash: string, overrides: Partial<OutcomeLogRow> = {}): OutcomeLogRow {
  return {
    intentHash,
    anchorId: 'cowrie',
    corridor: 'usdc-ngn',
    direction: 'withdraw',
    quotedRate: '1500.00',
    deliveredRate: '1500.00',
    quotedAmount: '100.00',
    deliveredAmount: '100.00',
    settleSeconds: 30,
    outcome: 'completed',
    createdAt: new Date().toISOString(),
    stellarTransactionId: 'tx-stellar-123',
    reconciledAt: new Date().toISOString(),
    disputed: false,
    disputedReason: null,
    publishedAt: null,
    oracleTxHash: null,
    attested: true,
    signerAccount: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    ...overrides,
  };
}

function requestWithWindow(window?: string): NextRequest {
  const url = window
    ? `http://localhost/api/v1/slippage-compliance?window=${window}`
    : 'http://localhost/api/v1/slippage-compliance';
  return new NextRequest(url);
}

describe('computeSlippageCompliance', () => {
  const now = 1_700_000_000_000;
  const dayMs = 24 * 60 * 60 * 1000;

  it('returns null compliance and gate not met when eligibleIntents is 0', () => {
    const res = computeSlippageCompliance([], [], { window: 30, now });
    expect(res).toEqual({
      window: 30,
      eligibleIntents: 0,
      breaches: 0,
      verifiedBreaches: 0,
      compliancePct: null,
      gate: {
        targetPct: 99.0,
        minIntents: 100,
        met: false,
      },
    });
  });

  it('filters out deposit direction rows, keeping only withdraw', () => {
    const withdrawRow = createOutcomeRow('hash-w', {
      direction: 'withdraw',
      createdAt: new Date(now - 5 * dayMs).toISOString(),
    });
    const depositRow = createOutcomeRow('hash-d', {
      direction: 'deposit',
      createdAt: new Date(now - 5 * dayMs).toISOString(),
    });

    const res = computeSlippageCompliance([withdrawRow, depositRow], [], { window: 30, now });
    expect(res.eligibleIntents).toBe(1);
    expect(res.compliancePct).toBe(100);
  });

  it('filters out rows and breaches outside the window', () => {
    const freshRow = createOutcomeRow('fresh', {
      createdAt: new Date(now - 10 * dayMs).toISOString(),
    });
    const staleRow = createOutcomeRow('stale', {
      createdAt: new Date(now - 40 * dayMs).toISOString(),
    });
    const freshBreach = createBreach('fresh-b', {
      status: 'verified',
      detectedAt: new Date(now - 10 * dayMs).toISOString(),
    });
    const staleBreach = createBreach('stale-b', {
      status: 'verified',
      detectedAt: new Date(now - 40 * dayMs).toISOString(),
    });

    const res30 = computeSlippageCompliance(
      [freshRow, staleRow],
      [freshBreach, staleBreach],
      { window: 30, now }
    );
    expect(res30.eligibleIntents).toBe(1);
    expect(res30.breaches).toBe(1);
    expect(res30.verifiedBreaches).toBe(1);
    expect(res30.compliancePct).toBe(0);

    const res90 = computeSlippageCompliance(
      [freshRow, staleRow],
      [freshBreach, staleBreach],
      { window: 90, now }
    );
    expect(res90.eligibleIntents).toBe(2);
    expect(res90.breaches).toBe(2);
    expect(res90.verifiedBreaches).toBe(2);

    const resAll = computeSlippageCompliance(
      [freshRow, staleRow],
      [freshBreach, staleBreach],
      { window: 'all', now }
    );
    expect(resAll.eligibleIntents).toBe(2);
    expect(resAll.breaches).toBe(2);
  });

  it('only verified breaches reduce compliance; detected and rejected do not', () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      createOutcomeRow(`hash-${i}`, { createdAt: new Date(now - dayMs).toISOString() })
    );
    const breaches = [
      createBreach('b1', { status: 'detected', detectedAt: new Date(now - dayMs).toISOString() }),
      createBreach('b2', { status: 'rejected', detectedAt: new Date(now - dayMs).toISOString() }),
      createBreach('b3', { status: 'verified', detectedAt: new Date(now - dayMs).toISOString() }),
    ];

    const res = computeSlippageCompliance(rows, breaches, { window: 30, now });
    expect(res.eligibleIntents).toBe(100);
    expect(res.breaches).toBe(3);
    expect(res.verifiedBreaches).toBe(1);
    // 99 / 100 = 99.0%
    expect(res.compliancePct).toBe(99.0);
    expect(res.gate.met).toBe(true);
  });

  it('gate requirement: eligibleIntents >= 100 and compliancePct >= 99.0', () => {
    // 99 intents with 0 breaches: 100% compliance, but met is false because < 100 intents
    const rows99 = Array.from({ length: 99 }, (_, i) =>
      createOutcomeRow(`hash-${i}`, { createdAt: new Date(now - dayMs).toISOString() })
    );
    const res99 = computeSlippageCompliance(rows99, [], { window: 30, now });
    expect(res99.compliancePct).toBe(100);
    expect(res99.gate.met).toBe(false);

    // 100 intents with 2 verified breaches: 98.0% compliance, met is false because < 99.0%
    const rows100 = Array.from({ length: 100 }, (_, i) =>
      createOutcomeRow(`hash-${i}`, { createdAt: new Date(now - dayMs).toISOString() })
    );
    const breaches2 = [
      createBreach('b1', { status: 'verified', detectedAt: new Date(now - dayMs).toISOString() }),
      createBreach('b2', { status: 'verified', detectedAt: new Date(now - dayMs).toISOString() }),
    ];
    const res100Bad = computeSlippageCompliance(rows100, breaches2, { window: 30, now });
    expect(res100Bad.compliancePct).toBe(98.0);
    expect(res100Bad.gate.met).toBe(false);

    // 100 intents with 1 verified breach: 99.0% compliance, met is true
    const breaches1 = [
      createBreach('b1', { status: 'verified', detectedAt: new Date(now - dayMs).toISOString() }),
    ];
    const res100Good = computeSlippageCompliance(rows100, breaches1, { window: 30, now });
    expect(res100Good.compliancePct).toBe(99.0);
    expect(res100Good.gate.met).toBe(true);
  });
});

describe('GET /api/v1/slippage-compliance', () => {
  let repStore: InMemoryReputationStore;
  let breachStore: InMemorySlippageBreachStore;

  beforeEach(() => {
    clearRateLimitStore();
    repStore = new InMemoryReputationStore();
    breachStore = new InMemorySlippageBreachStore();
    _setReputationStore(repStore);
    _setSlippageBreachStore(breachStore);
  });

  it('returns 200 with default window (30)', async () => {
    const res = await GET(requestWithWindow());
    const body: SlippageCompliance = await res.json();

    expect(res.status).toBe(200);
    expect(body.window).toBe(30);
    expect(body.eligibleIntents).toBe(0);
    expect(body.compliancePct).toBeNull();
    expect(body.gate).toEqual({ targetPct: 99.0, minIntents: 100, met: false });
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(res.headers.get('x-ratelimit-limit')).toBe('60');
    expect(res.headers.get('x-ratelimit-remaining')).toBeDefined();
  });

  it('returns 200 with window=90 and window=all', async () => {
    const res90 = await GET(requestWithWindow('90'));
    const body90: SlippageCompliance = await res90.json();
    expect(res90.status).toBe(200);
    expect(body90.window).toBe(90);

    const resAll = await GET(requestWithWindow('all'));
    const bodyAll: SlippageCompliance = await resAll.json();
    expect(resAll.status).toBe(200);
    expect(bodyAll.window).toBe('all');
  });

  it('returns 400 validation_error on invalid window', async () => {
    for (const invalid of ['60', '180', 'foo', '-1', '0']) {
      const res = await GET(requestWithWindow(invalid));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error?.code).toBe('validation_error');
    }
  });

  it('returns 503 store_unavailable when reputation store fails', async () => {
    const broken = {
      query: async () => {
        throw new Error('db down');
      },
    } as unknown as Parameters<typeof _setReputationStore>[0];
    _setReputationStore(broken);
    const res = await GET(requestWithWindow('30'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error?.code).toBe('store_unavailable');
  });

  it('returns 503 store_unavailable when breach store fails', async () => {
    const brokenBreaches = {
      list: async () => {
        throw new Error('breach db down');
      },
    } as unknown as Parameters<typeof _setSlippageBreachStore>[0];
    _setSlippageBreachStore(brokenBreaches);
    const res = await GET(requestWithWindow('30'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error?.code).toBe('store_unavailable');
  });

  it('computes compliance accurately from store records', async () => {
    for (let i = 0; i < 120; i++) {
      await repStore.append(
        createOutcomeRow(`intent-${i}`, {
          direction: 'withdraw',
          createdAt: new Date().toISOString(),
        })
      );
    }
    await breachStore.create(
      createBreach('intent-0', {
        status: 'verified',
        detectedAt: new Date().toISOString(),
      })
    );

    const res = await GET(requestWithWindow('30'));
    const body: SlippageCompliance = await res.json();

    expect(res.status).toBe(200);
    expect(body.eligibleIntents).toBe(120);
    expect(body.breaches).toBe(1);
    expect(body.verifiedBreaches).toBe(1);
    // (119 / 120) * 100 = 99.1666... -> 99.17%
    expect(body.compliancePct).toBe(99.17);
    expect(body.gate.met).toBe(true);
  });
});
