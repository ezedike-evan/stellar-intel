import { describe, it, expect, vi } from 'vitest';
import { diffDegraded, emitHealthChanges } from '@/lib/webhooks/health-diff';
import type { AnchorHealthLedger } from '@/lib/stellar/anchors';

describe('diffDegraded (#1342)', () => {
  it('reports nothing when nothing changed', () => {
    expect(diffDegraded({ a: false, b: true }, { a: false, b: true })).toEqual([]);
    expect(diffDegraded({}, {})).toEqual([]);
  });

  it('reports healthy to degraded', () => {
    expect(diffDegraded({ a: false }, { a: true })).toEqual([
      { anchorId: 'a', from: 'healthy', to: 'degraded' },
    ]);
  });

  it('reports degraded to healthy', () => {
    expect(diffDegraded({ a: true }, { a: false })).toEqual([
      { anchorId: 'a', from: 'degraded', to: 'healthy' },
    ]);
  });

  it('treats an anchor missing from prev as healthy, so a new degraded anchor is a change', () => {
    expect(diffDegraded({}, { fresh: true })).toEqual([
      { anchorId: 'fresh', from: 'healthy', to: 'degraded' },
    ]);
  });

  it('reports nothing for a new anchor that is healthy', () => {
    expect(diffDegraded({}, { fresh: false })).toEqual([]);
  });

  it('does not treat an anchor that left the ledger as a recovery', () => {
    expect(diffDegraded({ gone: true, kept: false }, { kept: false })).toEqual([]);
  });

  it('sorts the changes by anchor id, whatever order the input is in', () => {
    const changes = diffDegraded(
      { zulu: false, alpha: true, mike: false },
      { zulu: true, mike: true, alpha: false }
    );
    expect(changes.map((c) => c.anchorId)).toEqual(['alpha', 'mike', 'zulu']);
  });

  it('does not mutate its inputs', () => {
    const prev = { a: false };
    const next = { a: true };
    diffDegraded(prev, next);
    expect(prev).toEqual({ a: false });
    expect(next).toEqual({ a: true });
  });
});

describe('emitHealthChanges (#1342)', () => {
  function ledger(
    anchors: Record<string, { degraded: boolean; lastError?: string | null }>
  ): AnchorHealthLedger {
    return {
      thresholdNights: 3,
      updatedAt: '2026-10-25T00:00:00.000Z',
      anchors: Object.fromEntries(
        Object.entries(anchors).map(([id, a]) => [
          id,
          {
            consecutiveFailures: a.degraded ? 3 : 0,
            degraded: a.degraded,
            lastCheckedAt: '2026-10-25T00:00:00.000Z',
            lastStatus: a.degraded ? 'fail' : 'ok',
            lastError: a.lastError ?? null,
          },
        ])
      ),
    };
  }

  /** An in-memory stand-in for the shared snapshot row. */
  function fakeStore(initial: string | null = null) {
    let value = initial;
    return {
      getSnapshot: vi.fn(async () => value),
      setSnapshot: vi.fn(async (json: string) => {
        value = json;
      }),
      read: () => value,
    };
  }

  it('stores a snapshot and emits nothing on the first run', async () => {
    const store = fakeStore();
    const emit = vi.fn();

    const count = await emitHealthChanges({
      ledger: () => ledger({ a: { degraded: true }, b: { degraded: false } }),
      ...store,
      emit,
    });

    expect(count).toBe(0);
    expect(emit).not.toHaveBeenCalled();
    expect(JSON.parse(store.read()!)).toEqual({ a: true, b: false });
  });

  it('emits one event with the full payload for a single flip on the second run', async () => {
    const store = fakeStore();
    const emit = vi.fn();
    await emitHealthChanges({
      ledger: () => ledger({ a: { degraded: false }, b: { degraded: false } }),
      ...store,
      emit,
    });

    const count = await emitHealthChanges({
      ledger: () =>
        ledger({ a: { degraded: true, lastError: 'toml 503' }, b: { degraded: false } }),
      ...store,
      emit,
    });

    expect(count).toBe(1);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      'anchor.health_status_changed',
      {
        anchorId: 'a',
        from: 'healthy',
        to: 'degraded',
        lastCheckedAt: '2026-10-25T00:00:00.000Z',
        lastError: 'toml 503',
      },
      // The anchor, where it moved to, and the check that found it (WHK005).
      { idempotencyKey: 'anchor.health_status_changed:a:degraded:2026-10-25T00:00:00.000Z' }
    );
    expect(JSON.parse(store.read()!)).toEqual({ a: true, b: false });
  });

  it('emits nothing on a third run with no change', async () => {
    const store = fakeStore(JSON.stringify({ a: true }));
    const emit = vi.fn();

    const count = await emitHealthChanges({
      ledger: () => ledger({ a: { degraded: true } }),
      ...store,
      emit,
    });

    expect(count).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it('reports a recovery', async () => {
    const store = fakeStore(JSON.stringify({ a: true }));
    const emit = vi.fn();

    await emitHealthChanges({ ledger: () => ledger({ a: { degraded: false } }), ...store, emit });

    expect(emit).toHaveBeenCalledWith(
      'anchor.health_status_changed',
      expect.objectContaining({ anchorId: 'a', from: 'degraded', to: 'healthy' }),
      { idempotencyKey: 'anchor.health_status_changed:a:healthy:2026-10-25T00:00:00.000Z' }
    );
  });

  it('emits in anchor order when several flip', async () => {
    const store = fakeStore(JSON.stringify({ a: false, b: false, c: true }));
    const emit = vi.fn();

    const count = await emitHealthChanges({
      ledger: () =>
        ledger({ c: { degraded: false }, b: { degraded: true }, a: { degraded: true } }),
      ...store,
      emit,
    });

    expect(count).toBe(3);
    expect(
      emit.mock.calls.map(([, payload]) => (payload as { anchorId: string }).anchorId)
    ).toEqual(['a', 'b', 'c']);
  });

  it('treats an unreadable snapshot like a first run rather than flooding subscribers', async () => {
    const store = fakeStore('not json');
    const emit = vi.fn();

    const count = await emitHealthChanges({
      ledger: () => ledger({ a: { degraded: true } }),
      ...store,
      emit,
    });

    expect(count).toBe(0);
    expect(emit).not.toHaveBeenCalled();
    expect(JSON.parse(store.read()!)).toEqual({ a: true });
  });

  it('keeps the old snapshot when emitting throws, so the change is sent again next run', async () => {
    const store = fakeStore(JSON.stringify({ a: false }));
    const emit = vi.fn(() => {
      throw new Error('dispatch exploded');
    });

    await expect(
      emitHealthChanges({ ledger: () => ledger({ a: { degraded: true } }), ...store, emit })
    ).rejects.toThrow('dispatch exploded');

    expect(JSON.parse(store.read()!)).toEqual({ a: false });
  });

  it('emits the same key again when the snapshot write failed and the next run re-sends (WHK005)', async () => {
    let value: string | null = JSON.stringify({ a: false });
    const getSnapshot = vi.fn(async () => value);
    const setSnapshot = vi
      .fn(async (json: string) => {
        value = json;
      })
      .mockRejectedValueOnce(new Error('db down'));
    const emit = vi.fn();
    const run = () =>
      emitHealthChanges({
        ledger: () => ledger({ a: { degraded: true } }),
        getSnapshot,
        setSnapshot,
        emit,
      });

    // The event goes out, then the snapshot cannot be stored.
    await expect(run()).rejects.toThrow('db down');
    // So the next run sees the same change and sends it again.
    await expect(run()).resolves.toBe(1);

    expect(emit).toHaveBeenCalledTimes(2);
    const keys = emit.mock.calls.map(
      ([, , opts]) => (opts as { idempotencyKey: string }).idempotencyKey
    );
    expect(keys[0]).toBe('anchor.health_status_changed:a:degraded:2026-10-25T00:00:00.000Z');
    expect(keys[1]).toBe(keys[0]);
  });

  it('gives each anchor and each direction its own key', async () => {
    const store = fakeStore(JSON.stringify({ a: false, b: true }));
    const emit = vi.fn();

    await emitHealthChanges({
      ledger: () => ledger({ a: { degraded: true }, b: { degraded: false } }),
      ...store,
      emit,
    });

    expect(emit.mock.calls.map(([, , opts]) => opts)).toEqual([
      { idempotencyKey: 'anchor.health_status_changed:a:degraded:2026-10-25T00:00:00.000Z' },
      { idempotencyKey: 'anchor.health_status_changed:b:healthy:2026-10-25T00:00:00.000Z' },
    ]);
  });

  it('writes "none" into the key when the ledger has no check time for the anchor', async () => {
    const store = fakeStore(JSON.stringify({ a: false }));
    const emit = vi.fn();
    const noTime = ledger({ a: { degraded: true } });
    noTime.anchors.a!.lastCheckedAt = null;

    await emitHealthChanges({ ledger: () => noTime, ...store, emit });

    expect(emit).toHaveBeenCalledWith(
      'anchor.health_status_changed',
      expect.objectContaining({ anchorId: 'a', lastCheckedAt: null }),
      { idempotencyKey: 'anchor.health_status_changed:a:degraded:none' }
    );
  });

  it('uses the committed ledger by default and emits nothing without a database', async () => {
    // No DATABASE_URL in the unit environment: the snapshot is never stored, so
    // the real default path reports no changes and does not throw.
    await expect(emitHealthChanges({ emit: vi.fn() })).resolves.toBe(0);
  });
});
