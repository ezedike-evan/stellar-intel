import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Anchor, Sep1TomlData } from '@/types';
import { flags } from '@/lib/flags';

vi.mock('@/lib/stellar/anchors', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/stellar/anchors')>();
  return { ...actual, getAnchorsByCorridorId: vi.fn() };
});
vi.mock('@/lib/stellar/sep1', () => ({ resolveAnchor: vi.fn() }));
vi.mock('@/lib/stellar/sep38', () => ({
  assertSep38Capable: vi.fn(),
  getSep38Price: vi.fn(),
}));
vi.mock('@/lib/reputation/execution-sla-server', () => ({
  fetchCorridorSettleSummaries: vi.fn(),
}));
vi.mock('@/lib/reputation/scores', () => ({
  fetchReputationScores: vi.fn().mockResolvedValue(new Map()),
}));

import { fetchCorridorRates } from '@/lib/stellar/server-rates';
import { getAnchorsByCorridorId } from '@/lib/stellar/anchors';
import { resolveAnchor } from '@/lib/stellar/sep1';
import { assertSep38Capable, getSep38Price } from '@/lib/stellar/sep38';
import { fetchCorridorSettleSummaries } from '@/lib/reputation/execution-sla-server';

const anchor1: Anchor = {
  id: 'anchor-1',
  name: 'Anchor 1',
  homeDomain: 'anchor1.test',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
};

const anchor2: Anchor = {
  id: 'anchor-2',
  name: 'Anchor 2',
  homeDomain: 'anchor2.test',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
};

const originalExecutionSlaFlag = flags.executionSla;

beforeEach(() => {
  vi.mocked(getAnchorsByCorridorId).mockReturnValue([anchor1, anchor2]);
  vi.mocked(resolveAnchor).mockImplementation(async (domain: string) => {
    return {
      TRANSFER_SERVER_SEP0024: `https://${domain}/sep24`,
      ANCHOR_QUOTE_SERVER: `https://${domain}/sep38`,
    } as unknown as Sep1TomlData;
  });

  vi.mocked(assertSep38Capable).mockImplementation((toml) => toml.ANCHOR_QUOTE_SERVER as string);
  vi.mocked(getSep38Price).mockResolvedValue({
    buy_amount: '160000',
    sell_amount: '100',
    price: '1600',
    total_price: '1600',
  });
});

afterEach(() => {
  flags.executionSla = originalExecutionSlaFlag;
  vi.clearAllMocks();
});

describe('fetchCorridorRates — SLA settle time annotation (#2150)', () => {
  it('annotates matching rates with settleP95Ms and settleSampleSize when flag is on', async () => {
    flags.executionSla = true;
    vi.mocked(fetchCorridorSettleSummaries).mockResolvedValue(
      new Map([
        ['anchor-1', { p95Ms: 120_000, sampleSize: 45 }],
      ])
    );

    const result = await fetchCorridorRates('usdc-ngn', '100');

    expect(fetchCorridorSettleSummaries).toHaveBeenCalledWith('usdc-ngn');
    const r1 = result.rates.find((r) => r.anchorId === 'anchor-1');
    const r2 = result.rates.find((r) => r.anchorId === 'anchor-2');

    expect(r1).toBeDefined();
    expect(r1?.settleP95Ms).toBe(120_000);
    expect(r1?.settleSampleSize).toBe(45);

    expect(r2).toBeDefined();
    expect(r2?.settleP95Ms).toBeUndefined();
    expect(r2?.settleSampleSize).toBeUndefined();
  });

  it('does not call fetchCorridorSettleSummaries and sets no fields when flag is off', async () => {
    flags.executionSla = false;

    const result = await fetchCorridorRates('usdc-ngn', '100');

    expect(fetchCorridorSettleSummaries).not.toHaveBeenCalled();
    for (const rate of result.rates) {
      expect(rate.settleP95Ms).toBeUndefined();
      expect(rate.settleSampleSize).toBeUndefined();
    }
  });

  it('still returns rates unchanged when fetchCorridorSettleSummaries rejects', async () => {
    flags.executionSla = true;
    vi.mocked(fetchCorridorSettleSummaries).mockRejectedValue(new Error('store unavailable'));

    const result = await fetchCorridorRates('usdc-ngn', '100');

    expect(result.rates).toHaveLength(2);
    for (const rate of result.rates) {
      expect(rate.settleP95Ms).toBeUndefined();
      expect(rate.settleSampleSize).toBeUndefined();
    }
  });
});
