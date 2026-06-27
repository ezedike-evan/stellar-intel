import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AnchorRate } from '@/types';
import type { ServerRatesResult } from '../server-rates';

// fetchCorridorRates makes live anchor calls; stub it so the snapshot logic is
// tested deterministically with no network.
const fetchCorridorRates = vi.fn();
vi.mock('../server-rates', () => ({
  fetchCorridorRates: (corridorId: string, amount: string) =>
    fetchCorridorRates(corridorId, amount),
}));

import {
  buildBestAnchorSnapshot,
  getBestAnchorSnapshot,
  clearBestAnchorSnapshotCache,
} from '../snapshot';
import { CORRIDORS } from '@/constants/anchors';

function rate(over: Partial<AnchorRate> & Pick<AnchorRate, 'anchorId'>): AnchorRate {
  return {
    anchorName: over.anchorId,
    corridorId: 'usdc-ngn',
    fee: 0,
    feeType: 'flat',
    exchangeRate: 1500,
    totalReceived: 150_000,
    updatedAt: new Date(),
    source: 'sep38',
    ...over,
  };
}

function result(rates: AnchorRate[], bestRateId: string): ServerRatesResult {
  return {
    corridorId: rates[0]?.corridorId ?? 'usdc-ngn',
    rates,
    pending: [],
    bestRateId,
    errors: [],
  };
}

beforeEach(() => {
  clearBestAnchorSnapshotCache();
  fetchCorridorRates.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('buildBestAnchorSnapshot', () => {
  it('returns one entry per corridor with a stable shape', async () => {
    fetchCorridorRates.mockResolvedValue(result([rate({ anchorId: 'cowrie' })], 'cowrie'));

    const snap = await buildBestAnchorSnapshot('100');

    expect(snap.baseAmount).toBe('100');
    expect(snap.baseAsset).toBe('USDC');
    expect(typeof snap.generatedAt).toBe('string');
    expect(snap.corridors).toHaveLength(CORRIDORS.length);
    expect(snap.corridors[0]).toMatchObject({
      corridorId: CORRIDORS[0]!.id,
      to: CORRIDORS[0]!.to,
      countryCode: CORRIDORS[0]!.countryCode,
      best: { anchorId: 'cowrie' },
    });
  });

  it('selects the anchor flagged as best by the engine', async () => {
    fetchCorridorRates.mockResolvedValue(
      result(
        [
          rate({ anchorId: 'anclap', totalReceived: 140_000 }),
          rate({ anchorId: 'cowrie', totalReceived: 160_000 }),
        ],
        'cowrie'
      )
    );

    const snap = await buildBestAnchorSnapshot();

    expect(snap.corridors.every((c) => c.best?.anchorId === 'cowrie')).toBe(true);
    expect(snap.corridors[0]!.quoted).toBe(2);
  });

  it('yields best: null when a corridor has no quotes or throws', async () => {
    fetchCorridorRates
      .mockResolvedValueOnce(result([], ''))
      .mockRejectedValue(new Error('network down'));

    const snap = await buildBestAnchorSnapshot();

    expect(snap.corridors.every((c) => c.best === null)).toBe(true);
    expect(snap.corridors[0]!.quoted).toBe(0);
  });
});

describe('getBestAnchorSnapshot caching', () => {
  it('reuses the cached snapshot within the TTL', async () => {
    fetchCorridorRates.mockResolvedValue(result([rate({ anchorId: 'cowrie' })], 'cowrie'));

    const first = await getBestAnchorSnapshot();
    const callsAfterFirst = fetchCorridorRates.mock.calls.length;
    const second = await getBestAnchorSnapshot();

    expect(second).toBe(first);
    expect(fetchCorridorRates.mock.calls.length).toBe(callsAfterFirst);
  });

  it('recomputes when baseAmount differs', async () => {
    fetchCorridorRates.mockResolvedValue(result([rate({ anchorId: 'cowrie' })], 'cowrie'));

    await getBestAnchorSnapshot({ baseAmount: '100' });
    const calls = fetchCorridorRates.mock.calls.length;
    await getBestAnchorSnapshot({ baseAmount: '500' });

    expect(fetchCorridorRates.mock.calls.length).toBeGreaterThan(calls);
    expect(fetchCorridorRates).toHaveBeenLastCalledWith(expect.any(String), '500');
  });

  it('does not cache an all-empty snapshot', async () => {
    fetchCorridorRates.mockResolvedValue(result([], ''));

    await getBestAnchorSnapshot();
    const calls = fetchCorridorRates.mock.calls.length;
    await getBestAnchorSnapshot();

    expect(fetchCorridorRates.mock.calls.length).toBeGreaterThan(calls);
  });
});
