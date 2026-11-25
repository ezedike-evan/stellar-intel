import { describe, it, expect } from 'vitest';
import type { OutcomeLogRow } from '@/types/reputation';
import { detectSlippageBreach } from '@/lib/reputation/slippage-detect';
import { hashSlippageEvidence } from '@/lib/reputation/slippage-evidence';
import {
  InMemorySlippageBreachStore,
  type SlippageBreachStore,
} from '@/lib/reputation/slippage-breaches';

const FIXED_DATE = new Date('2026-11-22T12:00:00.000Z');
const FIXED_NOW = () => FIXED_DATE;

function makeRow(overrides: Partial<OutcomeLogRow> = {}): OutcomeLogRow {
  return {
    intentHash: 'c'.repeat(64),
    anchorId: 'cowrie',
    corridor: 'ngnt-ngn',
    direction: 'withdraw',
    quotedRate: '1500.0',
    deliveredRate: '1450.0',
    quotedAmount: '100',
    deliveredAmount: '950.0',
    settleSeconds: 45,
    outcome: 'completed',
    createdAt: '2026-11-22T11:59:00.000Z',
    stellarTransactionId: 'd'.repeat(64),
    reconciledAt: null,
    disputed: false,
    disputedReason: null,
    publishedAt: null,
    oracleTxHash: null,
    attested: true,
    signerAccount: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7',
    minReceive: '1000.0',
    ...overrides,
  };
}

describe('detectSlippageBreach', () => {
  it('completed below floor -> breach stored with status detected, evidence.onChain === null, and evidenceHash === await hashSlippageEvidence(evidence)', async () => {
    const store = new InMemorySlippageBreachStore();
    const row = makeRow({
      minReceive: '1000.0',
      deliveredAmount: '980.0',
      outcome: 'completed',
    });

    const result = await detectSlippageBreach(row, 'anchor-tx-999', {
      store,
      now: FIXED_NOW,
    });

    expect(result.kind).toBe('breach');
    if (result.kind !== 'breach') throw new Error('expected breach');

    const { breach } = result;
    expect(breach.status).toBe('detected');
    expect(breach.rejectionReason).toBeNull();
    expect(breach.verifiedAt).toBeNull();
    expect(breach.detectedAt).toBe(FIXED_DATE.toISOString());
    expect(breach.amountOut).toBe('980.0');
    expect(breach.minReceive).toBe('1000.0');
    expect(breach.shortfall).toBe('20');
    expect(breach.shortfallBps).toBe(200);
    expect(breach.anchorTransactionId).toBe('anchor-tx-999');
    expect(breach.stellarTransactionId).toBe('d'.repeat(64));

    // Evidence checks
    expect(breach.evidence.onChain).toBeNull();
    expect(breach.evidence.shortfall).toBe('20');
    expect(breach.evidence.shortfallBps).toBe(200);
    expect(breach.evidenceHash).toBe(await hashSlippageEvidence(breach.evidence));

    // Stored in store
    const stored = await store.get(row.intentHash);
    expect(stored).not.toBeNull();
    expect(stored?.intentHash).toBe(row.intentHash);
    expect(stored?.evidenceHash).toBe(breach.evidenceHash);
  });

  it('met -> nothing stored', async () => {
    const store = new InMemorySlippageBreachStore();
    const row = makeRow({
      minReceive: '1000.0',
      deliveredAmount: '1005.0',
      outcome: 'completed',
    });

    const result = await detectSlippageBreach(row, 'anchor-tx-123', {
      store,
      now: FIXED_NOW,
    });

    expect(result.kind).toBe('met');
    expect(await store.get(row.intentHash)).toBeNull();
  });

  it('deposit row -> not_applicable', async () => {
    const store = new InMemorySlippageBreachStore();
    const row = makeRow({
      direction: 'deposit',
      minReceive: '1000.0',
      deliveredAmount: '950.0',
    });

    const result = await detectSlippageBreach(row, 'tx-1', { store, now: FIXED_NOW });
    expect(result.kind).toBe('not_applicable');
    expect(await store.get(row.intentHash)).toBeNull();
  });

  it('unattested row -> not_applicable', async () => {
    const store = new InMemorySlippageBreachStore();
    const row = makeRow({
      attested: false,
      minReceive: '1000.0',
      deliveredAmount: '950.0',
    });

    const result = await detectSlippageBreach(row, 'tx-1', { store, now: FIXED_NOW });
    expect(result.kind).toBe('not_applicable');
    expect(await store.get(row.intentHash)).toBeNull();
  });

  it('row with null signerAccount -> not_applicable', async () => {
    const store = new InMemorySlippageBreachStore();
    const row = makeRow({
      signerAccount: null,
      minReceive: '1000.0',
      deliveredAmount: '950.0',
    });

    const result = await detectSlippageBreach(row, 'tx-1', { store, now: FIXED_NOW });
    expect(result.kind).toBe('not_applicable');
    expect(await store.get(row.intentHash)).toBeNull();
  });

  it('no floor -> not_applicable', async () => {
    const store = new InMemorySlippageBreachStore();
    const row = makeRow({
      minReceive: null,
      deliveredAmount: '950.0',
    });

    const result = await detectSlippageBreach(row, 'tx-1', { store, now: FIXED_NOW });
    expect(result.kind).toBe('not_applicable');
    expect(await store.get(row.intentHash)).toBeNull();
  });

  it('store.create throws -> { kind: "error" }', async () => {
    const failingStore: SlippageBreachStore = {
      create: async () => {
        throw new Error('Database write failed');
      },
      get: async () => null,
      list: async () => [],
      resolveVerification: async () => null,
    };

    const row = makeRow({
      minReceive: '1000.0',
      deliveredAmount: '980.0',
    });

    const result = await detectSlippageBreach(row, 'tx-1', {
      store: failingStore,
      now: FIXED_NOW,
    });

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe('Database write failed');
    }
  });
});
