import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TRACKED_INTENTS_KEY,
  TRACKED_INTENTS_MAX,
  listTrackedIntents,
  rememberTrackedIntent,
  type TrackedIntent,
} from '@/lib/refunds/local-history';

function entry(i: number, over: Partial<TrackedIntent> = {}): TrackedIntent {
  return {
    intentHash: i.toString(16).padStart(64, '0'),
    anchorId: 'cowrie',
    corridor: 'usdc-ngn',
    direction: 'withdraw',
    transactionId: `tx-${i}`,
    startedAt: new Date(Date.UTC(2026, 10, 1) + i * 60_000).toISOString(),
    ...over,
  };
}

describe('refund local history (#2123)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('round-trips a remembered intent', () => {
    rememberTrackedIntent(entry(1));
    expect(listTrackedIntents()).toEqual([entry(1)]);
  });

  it('stores no signature and no public key', () => {
    rememberTrackedIntent({
      ...entry(1),
      signature: 'sig',
      publicKey: 'GABC',
    } as unknown as TrackedIntent);

    const raw = localStorage.getItem(TRACKED_INTENTS_KEY)!;
    expect(raw).not.toContain('signature');
    expect(raw).not.toContain('publicKey');
  });

  it('dedupes by intentHash, keeping the newest', () => {
    rememberTrackedIntent(entry(1));
    rememberTrackedIntent(entry(1, { transactionId: 'tx-newer', startedAt: entry(5).startedAt }));

    const list = listTrackedIntents();
    expect(list).toHaveLength(1);
    expect(list[0]!.transactionId).toBe('tx-newer');
  });

  it('keeps only the newest 50 of 51 entries, newest first', () => {
    for (let i = 1; i <= TRACKED_INTENTS_MAX + 1; i++) rememberTrackedIntent(entry(i));

    const list = listTrackedIntents();
    expect(list).toHaveLength(TRACKED_INTENTS_MAX);
    expect(list[0]!.transactionId).toBe('tx-51');
    expect(list.at(-1)!.transactionId).toBe('tx-2');
  });

  it('returns [] for corrupt JSON', () => {
    localStorage.setItem(TRACKED_INTENTS_KEY, '{not json');
    expect(listTrackedIntents()).toEqual([]);
  });

  it('drops entries that fail shape checks', () => {
    localStorage.setItem(
      TRACKED_INTENTS_KEY,
      JSON.stringify([entry(1), { intentHash: 'x' }, { ...entry(2), direction: 'sideways' }])
    );
    expect(listTrackedIntents()).toEqual([entry(1)]);
  });

  it('does not throw when localStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => rememberTrackedIntent(entry(1))).not.toThrow();
  });
});
