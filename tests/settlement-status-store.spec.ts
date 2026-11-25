import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InMemorySettlementStatusStore,
  PostgresSettlementStatusStore,
  _resetSettlementStatusSchema,
  _setSettlementStatusStore,
  getSettlementStatusStore,
} from '@/lib/webhooks/settlement-status';

const executor = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('@/lib/reputation/pool', () => ({
  getSqlExecutor: () => executor,
  hasDatabaseUrl: () => Boolean(process.env.DATABASE_URL),
}));

describe('InMemorySettlementStatusStore', () => {
  let store: InMemorySettlementStatusStore;

  beforeEach(() => {
    store = new InMemorySettlementStatusStore();
  });

  it('returns null on the first swap for a key', async () => {
    const prev = await store.swap(
      { anchorId: 'cowrie', transactionId: 'tx-1' },
      'pending_anchor',
      '2026-11-20T10:00:00.000Z'
    );
    expect(prev).toBeNull();
  });

  it('returns previous status on subsequent swap', async () => {
    await store.swap(
      { anchorId: 'cowrie', transactionId: 'tx-1' },
      'pending_anchor',
      '2026-11-20T10:00:00.000Z'
    );
    const prev = await store.swap(
      { anchorId: 'cowrie', transactionId: 'tx-1' },
      'completed',
      '2026-11-20T10:05:00.000Z'
    );
    expect(prev).toBe('pending_anchor');
  });

  it('returns current status if swap is called with identical status', async () => {
    await store.swap(
      { anchorId: 'cowrie', transactionId: 'tx-1' },
      'pending_anchor',
      '2026-11-20T10:00:00.000Z'
    );
    const prev = await store.swap(
      { anchorId: 'cowrie', transactionId: 'tx-1' },
      'pending_anchor',
      '2026-11-20T10:01:00.000Z'
    );
    expect(prev).toBe('pending_anchor');
  });

  it('differentiates by anchorId and transactionId', async () => {
    await store.swap(
      { anchorId: 'cowrie', transactionId: 'tx-1' },
      'pending_anchor',
      '2026-11-20T10:00:00.000Z'
    );
    const prevOtherTx = await store.swap(
      { anchorId: 'cowrie', transactionId: 'tx-2' },
      'pending_anchor',
      '2026-11-20T10:00:00.000Z'
    );
    const prevOtherAnchor = await store.swap(
      { anchorId: 'moneygram', transactionId: 'tx-1' },
      'pending_anchor',
      '2026-11-20T10:00:00.000Z'
    );
    expect(prevOtherTx).toBeNull();
    expect(prevOtherAnchor).toBeNull();
  });

  it('clear removes all entries', async () => {
    await store.swap(
      { anchorId: 'cowrie', transactionId: 'tx-1' },
      'pending_anchor',
      '2026-11-20T10:00:00.000Z'
    );
    store.clear();
    const prev = await store.swap(
      { anchorId: 'cowrie', transactionId: 'tx-1' },
      'completed',
      '2026-11-20T10:05:00.000Z'
    );
    expect(prev).toBeNull();
  });
});

describe('PostgresSettlementStatusStore', () => {
  let store: PostgresSettlementStatusStore;

  beforeEach(() => {
    executor.query.mockReset();
    _resetSettlementStatusSchema();
    store = new PostgresSettlementStatusStore();
  });

  afterEach(() => {
    _resetSettlementStatusSchema();
  });

  it('ensures schema DDL runs once and performs upsert', async () => {
    executor.query
      .mockResolvedValueOnce({ rows: [] }) // DDL
      .mockResolvedValueOnce({ rows: [] }); // Upsert returning empty old status (new insert)

    const prev = await store.swap(
      { anchorId: 'cowrie', transactionId: 'tx-1' },
      'pending_anchor',
      '2026-11-20T10:00:00.000Z'
    );

    expect(prev).toBeNull();
    expect(executor.query).toHaveBeenCalledTimes(2);
    expect(executor.query.mock.calls[0]?.[0]).toContain(
      'CREATE TABLE IF NOT EXISTS settlement_status'
    );
    expect(executor.query.mock.calls[1]?.[0]).toContain('WITH old AS');
  });

  it('returns previous status from old row', async () => {
    executor.query
      .mockResolvedValueOnce({ rows: [] }) // DDL
      .mockResolvedValueOnce({ rows: [{ previous: 'pending_anchor' }] }); // Upsert

    const prev = await store.swap(
      { anchorId: 'cowrie', transactionId: 'tx-1' },
      'completed',
      '2026-11-20T10:05:00.000Z'
    );

    expect(prev).toBe('pending_anchor');
  });
});

describe('getSettlementStatusStore singleton', () => {
  afterEach(() => {
    _setSettlementStatusStore(null);
  });

  it('returns in-memory store when DATABASE_URL is not set', () => {
    _setSettlementStatusStore(null);
    delete process.env.DATABASE_URL;
    const store = getSettlementStatusStore();
    expect(store).toBeInstanceOf(InMemorySettlementStatusStore);
  });

  it('returns custom store when explicitly set', () => {
    const custom = new InMemorySettlementStatusStore();
    _setSettlementStatusStore(custom);
    expect(getSettlementStatusStore()).toBe(custom);
  });
});
