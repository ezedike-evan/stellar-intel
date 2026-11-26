import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InMemorySettlementStatusStore,
  _setSettlementStatusStore,
  observeSettlementStatus,
  type ObserveSettlementStatusParams,
} from '@/lib/webhooks/settlement-status';
import * as sep24Module from '@/lib/stellar/sep24';
import * as sep6Module from '@/lib/stellar/sep6';
import { SettlementStatusChangedPayloadSchema } from '@/types/webhooks';

// WHK011 (#2189): every observed status change is one settlement.status_changed event.

const PARAMS: ObserveSettlementStatusParams = {
  anchorId: 'moneygram',
  transferServer: 'https://stellar.moneygram.com/sep24',
  transactionId: 'txn-12345',
  protocol: 'sep24',
  direction: 'withdraw',
  intentHash: 'a'.repeat(64),
  jwt: 'mock-jwt',
};

type Emit = (
  kind: string,
  payload: Record<string, unknown>,
  opts?: { idempotencyKey?: string }
) => void;

describe('observeSettlementStatus emits settlement.status_changed (WHK011)', () => {
  let sep24: ReturnType<typeof vi.spyOn>;
  let emit: ReturnType<typeof vi.fn<Emit>>;

  beforeEach(() => {
    _setSettlementStatusStore(new InMemorySettlementStatusStore());
    sep24 = vi.spyOn(sep24Module, 'getSep24Transaction');
    emit = vi.fn<Emit>();
  });

  afterEach(() => {
    _setSettlementStatusStore(null);
    vi.restoreAllMocks();
  });

  function anchorSays(status: string) {
    sep24.mockResolvedValueOnce({ id: PARAMS.transactionId, status } as never);
  }

  function observe(over: Partial<ObserveSettlementStatusParams> = {}) {
    return observeSettlementStatus({ ...PARAMS, ...over }, { emit: emit as never });
  }

  it('emits the first observation with from: null', async () => {
    anchorSays('pending_anchor');

    await observe();

    expect(emit).toHaveBeenCalledTimes(1);
    const [kind, payload] = emit.mock.calls[0]!;
    expect(kind).toBe('settlement.status_changed');
    expect(payload).toEqual({
      anchorId: 'moneygram',
      transactionId: 'txn-12345',
      protocol: 'sep24',
      direction: 'withdraw',
      from: null,
      to: 'pending_anchor',
      terminal: false,
      intentHash: 'a'.repeat(64),
      observedAt: expect.any(String),
    });
  });

  it('emits nothing when the status is the one already recorded', async () => {
    anchorSays('pending_anchor');
    anchorSays('pending_anchor');
    await observe();
    emit.mockClear();

    const second = await observe();

    expect(second.changed).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits a transition with the status it left and the one it reached', async () => {
    anchorSays('pending_anchor');
    anchorSays('pending_stellar');
    await observe();
    emit.mockClear();

    await observe();

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![1]).toMatchObject({
      from: 'pending_anchor',
      to: 'pending_stellar',
      terminal: false,
    });
  });

  it('marks a terminal status', async () => {
    anchorSays('pending_anchor');
    anchorSays('completed');
    await observe();
    emit.mockClear();

    await observe();

    expect(emit.mock.calls[0]![1]).toMatchObject({
      from: 'pending_anchor',
      to: 'completed',
      terminal: true,
    });
  });

  it('emits one event for each change over a whole lifecycle, and none for the repeats', async () => {
    for (const status of [
      'incomplete',
      'incomplete',
      'pending_anchor',
      'pending_anchor',
      'completed',
      'completed',
    ]) {
      anchorSays(status);
      await observe();
    }

    expect(emit.mock.calls.map(([, payload]) => [payload['from'], payload['to']])).toEqual([
      [null, 'incomplete'],
      ['incomplete', 'pending_anchor'],
      ['pending_anchor', 'completed'],
    ]);
  });

  it('sends a payload the WHK003 schema accepts, with and without an intent hash', async () => {
    anchorSays('pending_anchor');
    await observe();
    expect(SettlementStatusChangedPayloadSchema.safeParse(emit.mock.calls[0]![1]).success).toBe(
      true
    );

    anchorSays('pending_anchor');
    await observe({ transactionId: 'txn-no-intent', intentHash: undefined });
    const payload = emit.mock.calls[1]![1];
    expect(payload['intentHash']).toBeNull();
    expect(SettlementStatusChangedPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('stamps the payload with the time of the observation', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-26T10:10:00.000Z'));
      anchorSays('pending_anchor');
      await observe();
      expect(emit.mock.calls[0]![1]['observedAt']).toBe('2026-11-26T10:10:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keys the event on the anchor, the transaction and the status it reached', async () => {
    anchorSays('pending_anchor');
    anchorSays('completed');
    await observe();
    await observe();

    expect(emit.mock.calls.map(([, , opts]) => opts)).toEqual([
      { idempotencyKey: 'settlement.status_changed:moneygram:txn-12345:pending_anchor' },
      { idempotencyKey: 'settlement.status_changed:moneygram:txn-12345:completed' },
    ]);
  });

  it('keeps two transactions, and two anchors with the same transaction id, apart', async () => {
    anchorSays('pending_anchor');
    anchorSays('pending_anchor');
    anchorSays('pending_anchor');
    await observe();
    await observe({ transactionId: 'txn-other' });
    await observe({ anchorId: 'cowrie' });

    expect(emit).toHaveBeenCalledTimes(3);
    expect(new Set(emit.mock.calls.map(([, , opts]) => opts?.idempotencyKey)).size).toBe(3);
  });

  it('reports the SEP-6 protocol and the deposit direction it was asked about', async () => {
    const sep6 = vi.spyOn(sep6Module, 'getSep6Transaction');
    sep6.mockResolvedValueOnce({ id: 'txn-6', status: 'pending_external' } as never);

    await observe({ protocol: 'sep6', direction: 'deposit', transactionId: 'txn-6' });

    expect(emit.mock.calls[0]![1]).toMatchObject({
      protocol: 'sep6',
      direction: 'deposit',
      to: 'pending_external',
    });
  });

  it('never emits intent.settled or intent.failed, even for a terminal status', async () => {
    for (const status of ['completed', 'error', 'refunded', 'expired']) {
      anchorSays(status);
      await observe({ transactionId: `txn-${status}` });
    }

    expect(new Set(emit.mock.calls.map(([kind]) => kind))).toEqual(
      new Set(['settlement.status_changed'])
    );
  });

  it('emits nothing when the anchor cannot be read', async () => {
    sep24.mockRejectedValueOnce(new Error('anchor down'));

    await expect(observe()).rejects.toThrow('anchor down');

    expect(emit).not.toHaveBeenCalled();
  });
});
