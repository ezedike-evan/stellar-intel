import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/stellar/anchors', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/stellar/anchors')>('@/lib/stellar/anchors');
  return {
    ...actual,
    getAnchorsByCorridorId: vi.fn(),
    getCorridorById: vi.fn(),
  };
});

import * as anchors from '@/lib/stellar/anchors';
import {
  depositLimitStatus,
  estimateDepositForAnchor,
  fetchDepositRates,
  InvalidDepositAmountError,
  NoDepositRateError,
  type DepositRateDeps,
} from '@/lib/stellar/deposit-rates';
import { serverRatesConfig } from '@/lib/stellar/server-rates';
import type { Sep24InfoResponse } from '@/lib/stellar/sep24';
import type { Anchor, Corridor, DepositRate, Sep1TomlData } from '@/types';

const mockGetAnchorsByCorridorId = vi.mocked(anchors.getAnchorsByCorridorId);
const mockGetCorridorById = vi.mocked(anchors.getCorridorById);

const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const USDC_ID = `stellar:USDC:${USDC_ISSUER}`;

const CORRIDOR: Corridor = {
  id: 'usdc-ngn',
  from: 'USDC',
  fromIssuer: USDC_ISSUER,
  fromPeg: 'USD',
  to: 'NGN',
  countryCode: 'NG',
  countryName: 'Nigeria',
};

const ANCHOR_A: Anchor = {
  id: 'anchor-a',
  name: 'Anchor A',
  homeDomain: 'a.example.com',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: USDC_ISSUER,
};

const ANCHOR_B: Anchor = {
  id: 'anchor-b',
  name: 'Anchor B',
  homeDomain: 'b.example.com',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: USDC_ISSUER,
};

function toml(domain: string): Sep1TomlData {
  return { TRANSFER_SERVER_SEP0024: `https://${domain}/sep24` } as Sep1TomlData;
}

function infoWith(deposit: Sep24InfoResponse['deposit']): Sep24InfoResponse {
  return {
    deposit,
    withdraw: {},
    fee: { enabled: true },
    transaction: { enabled: true },
    transactions: { enabled: true },
  };
}

/** Deps serving one /info per transfer server and one reference price per asset code. */
function makeDeps(
  infoByServer: Record<string, Sep24InfoResponse | Error>,
  priceByCode: Record<string, number>
): DepositRateDeps {
  return {
    resolveAnchor: vi.fn(async (domain: string) => toml(domain)),
    getSep24Info: vi.fn(async (transferServer: string) => {
      const entry = infoByServer[transferServer];
      if (!entry) throw new Error(`unexpected /info request to ${transferServer}`);
      if (entry instanceof Error) throw entry;
      return entry;
    }),
    referenceMidPrice: vi.fn(async (asset: { code: string }, fiatCode: string) => {
      const price = priceByCode[asset.code];
      if (price === undefined) {
        throw new Error(`no reference book for ${asset.code}/${fiatCode}`);
      }
      return { price, source: 'fx' as const, detail: `test USD→${fiatCode} reference` };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCorridorById.mockImplementation((id: string) => {
    if (id === CORRIDOR.id) return CORRIDOR;
    throw new Error(`Unknown corridor: ${id}`);
  });
  mockGetAnchorsByCorridorId.mockReturnValue([ANCHOR_A, ANCHOR_B]);
});

describe('fetchDepositRates', () => {
  it('ranks every anchor on the corridor by totalReceived', async () => {
    const deps = makeDeps(
      {
        'https://a.example.com/sep24': infoWith({ [USDC_ID]: { enabled: true, fee_fixed: 1 } }),
        'https://b.example.com/sep24': infoWith({ [USDC_ID]: { enabled: true } }),
      },
      { USDC: 1500 } // NGN per 1 USDC
    );

    const result = await fetchDepositRates('usdc-ngn', '150000', { deps });

    expect(result.direction).toBe('deposit');
    expect(result.errors).toEqual([]);
    expect(result.rates.map((r) => r.anchorId)).toEqual(['anchor-b', 'anchor-a']);
    expect(result.bestRateId).toBe('anchor-b');

    const [best, second] = result.rates;
    // 150000 NGN / 1500 = 100 USDC gross; B charges no fee, A a 1 USDC flat fee.
    expect(best!.totalReceived).toBeCloseTo(100, 7);
    expect(second!.totalReceived).toBeCloseTo(99, 7);
    expect(second!.fee).toBe(1);
    expect(best!.asset).toBe(USDC_ID);
    expect(best!.exchangeRate).toBeCloseTo(100 / 150000, 10);
    expect(best!.source).toBe('sep24-fee');
    expect(best!.referenceSource).toBe('test USD→NGN reference');
  });

  it('produces one row per enabled deposit asset', async () => {
    mockGetAnchorsByCorridorId.mockReturnValue([ANCHOR_A]);
    const deps = makeDeps(
      {
        'https://a.example.com/sep24': infoWith({
          [USDC_ID]: { enabled: true },
          native: { enabled: true, min_amount: 10, max_amount: 10000 },
        }),
      },
      { USDC: 1500, XLM: 500 }
    );

    const result = await fetchDepositRates('usdc-ngn', '150000', { deps });

    expect(result.errors).toEqual([]);
    expect(result.rates).toHaveLength(2);
    // 150000 / 500 = 300 XLM beats 100 USDC on raw units received.
    expect(result.rates[0]!.asset).toBe('stellar:native');
    expect(result.rates[0]!.totalReceived).toBeCloseTo(300, 7);
    expect(result.rates[0]!.minAmount).toBe(10);
    expect(result.rates[0]!.maxAmount).toBe(10000);
    expect(result.rates[1]!.asset).toBe(USDC_ID);
  });

  it('filters rows to opts.asset when given', async () => {
    mockGetAnchorsByCorridorId.mockReturnValue([ANCHOR_A]);
    const deps = makeDeps(
      {
        'https://a.example.com/sep24': infoWith({
          [USDC_ID]: { enabled: true },
          native: { enabled: true },
        }),
      },
      { USDC: 1500, XLM: 500 }
    );

    const result = await fetchDepositRates('usdc-ngn', '150000', { deps, asset: USDC_ID });

    expect(result.rates.map((r) => r.asset)).toEqual([USDC_ID]);
  });

  describe('anchors that key /info by bare asset code', () => {
    it('takes the issuer from the registry, so USDC is not labelled native', async () => {
      mockGetAnchorsByCorridorId.mockReturnValue([ANCHOR_A]);
      const deps = makeDeps(
        { 'https://a.example.com/sep24': infoWith({ USDC: { enabled: true } }) },
        { USDC: 1500 }
      );

      const result = await fetchDepositRates('usdc-ngn', '150000', { deps });

      expect(result.errors).toEqual([]);
      expect(result.rates.map((r) => r.asset)).toEqual([USDC_ID]);
      expect(deps.referenceMidPrice).toHaveBeenCalledWith(
        { code: 'USDC', issuer: USDC_ISSUER },
        'NGN'
      );
    });

    it('matches opts.asset given as a SEP-38 identifier', async () => {
      mockGetAnchorsByCorridorId.mockReturnValue([ANCHOR_A]);
      const deps = makeDeps(
        { 'https://a.example.com/sep24': infoWith({ USDC: { enabled: true } }) },
        { USDC: 1500 }
      );

      const result = await fetchDepositRates('usdc-ngn', '150000', { deps, asset: USDC_ID });

      expect(result.rates.map((r) => r.asset)).toEqual([USDC_ID]);
    });

    it('takes the issuer of a non-primary asset from a corridor the anchor serves', async () => {
      const NGNC_ISSUER = 'GDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const ngnc: Corridor = {
        ...CORRIDOR,
        id: 'ngnc-ngn',
        from: 'NGNC',
        fromIssuer: NGNC_ISSUER,
        fromPeg: 'NGN',
      };
      mockGetCorridorById.mockImplementation((id: string) => {
        if (id === CORRIDOR.id) return CORRIDOR;
        if (id === ngnc.id) return ngnc;
        throw new Error(`Unknown corridor: ${id}`);
      });
      const anchor: Anchor = { ...ANCHOR_A, corridors: ['usdc-ngn', 'ngnc-ngn'] };
      mockGetAnchorsByCorridorId.mockReturnValue([anchor]);
      const deps = makeDeps(
        { 'https://a.example.com/sep24': infoWith({ NGNC: { enabled: true } }) },
        { NGNC: 1 }
      );

      const result = await fetchDepositRates('usdc-ngn', '150000', { deps });

      expect(result.rates.map((r) => r.asset)).toEqual([`stellar:NGNC:${NGNC_ISSUER}`]);
    });

    it('records an error instead of quoting an unknown code as native XLM', async () => {
      mockGetAnchorsByCorridorId.mockReturnValue([ANCHOR_A]);
      const deps = makeDeps(
        { 'https://a.example.com/sep24': infoWith({ MYSTERY: { enabled: true } }) },
        { MYSTERY: 1 }
      );

      const result = await fetchDepositRates('usdc-ngn', '150000', { deps });

      expect(result.rates).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.reason).toContain('MYSTERY');
      expect(result.errors[0]!.reason).toContain('no issuer');
    });

    it('still prices native XLM, which has no issuer', async () => {
      mockGetAnchorsByCorridorId.mockReturnValue([ANCHOR_A]);
      const deps = makeDeps(
        { 'https://a.example.com/sep24': infoWith({ native: { enabled: true } }) },
        { XLM: 500 }
      );

      const result = await fetchDepositRates('usdc-ngn', '150000', { deps });

      expect(result.rates.map((r) => r.asset)).toEqual(['stellar:native']);
    });
  });

  it('gives up on a hung /info instead of stalling the comparison', async () => {
    const before = { ...serverRatesConfig.sep24Info };
    serverRatesConfig.sep24Info.timeoutMs = 20;
    serverRatesConfig.sep24Info.retryAttempts = 0;
    try {
      mockGetAnchorsByCorridorId.mockReturnValue([ANCHOR_A, ANCHOR_B]);
      const deps = makeDeps(
        { 'https://b.example.com/sep24': infoWith({ [USDC_ID]: { enabled: true } }) },
        { USDC: 1500 }
      );
      deps.getSep24Info = vi.fn(async (transferServer: string) => {
        if (transferServer === 'https://a.example.com/sep24') return new Promise<never>(() => {});
        return infoWith({ [USDC_ID]: { enabled: true } });
      });

      const result = await fetchDepositRates('usdc-ngn', '150000', { deps });

      expect(result.rates.map((r) => r.anchorId)).toEqual(['anchor-b']);
      expect(result.errors.map((e) => e.anchorId)).toEqual(['anchor-a']);
    } finally {
      Object.assign(serverRatesConfig.sep24Info, before);
    }
  });

  it('excludes assets the anchor disables', async () => {
    mockGetAnchorsByCorridorId.mockReturnValue([ANCHOR_A]);
    const deps = makeDeps(
      {
        'https://a.example.com/sep24': infoWith({
          [USDC_ID]: { enabled: true },
          SRT: { enabled: false },
        }),
      },
      { USDC: 1500, SRT: 1 }
    );

    const result = await fetchDepositRates('usdc-ngn', '150000', { deps });

    expect(result.rates.map((r) => r.asset)).toEqual([USDC_ID]);
    expect(result.errors).toEqual([]);
  });

  it('falls back to the registered asset when /info lists nothing usable', async () => {
    mockGetAnchorsByCorridorId.mockReturnValue([ANCHOR_A]);
    const deps = makeDeps({ 'https://a.example.com/sep24': infoWith({}) }, { USDC: 1500 });

    const result = await fetchDepositRates('usdc-ngn', '150000', { deps });

    expect(result.errors).toEqual([]);
    expect(result.rates).toHaveLength(1);
    expect(result.rates[0]!.asset).toBe(USDC_ID);
    expect(result.rates[0]!.fee).toBeNull(); // no published fee data to subtract
    expect(result.rates[0]!.totalReceived).toBeCloseTo(100, 7);
  });

  it('isolates a failing anchor into errors without rejecting the comparison', async () => {
    const deps = makeDeps(
      {
        'https://a.example.com/sep24': infoWith({ [USDC_ID]: { enabled: true } }),
        'https://b.example.com/sep24': new Error('HTTP 500 from /info'),
      },
      { USDC: 1500 }
    );

    const result = await fetchDepositRates('usdc-ngn', '150000', { deps });

    expect(result.rates.map((r) => r.anchorId)).toEqual(['anchor-a']);
    expect(result.bestRateId).toBe('anchor-a');
    expect(result.errors).toEqual([
      { anchorId: 'anchor-b', anchorName: 'Anchor B', reason: 'HTTP 500 from /info' },
    ]);
  });

  it('records a missing reference price per asset, keeping the anchor out of rates', async () => {
    mockGetAnchorsByCorridorId.mockReturnValue([ANCHOR_A]);
    const deps = makeDeps(
      {
        'https://a.example.com/sep24': infoWith({
          [USDC_ID]: { enabled: true },
          native: { enabled: true },
        }),
      },
      { USDC: 1500 } // no XLM book
    );

    const result = await fetchDepositRates('usdc-ngn', '150000', { deps });

    expect(result.rates.map((r) => r.asset)).toEqual([USDC_ID]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.reason).toContain('XLM');
    expect(result.errors[0]!.reason).toContain('no reference book');
  });
});

describe('estimateDepositForAnchor', () => {
  it('estimates one anchor and attributes the registered corridor', async () => {
    const deps = makeDeps(
      {
        'https://a.example.com/sep24': infoWith({
          [USDC_ID]: {
            enabled: true,
            fee_fixed: 1,
            fee_percent: 2,
            min_amount: 5,
            max_amount: 500,
          },
        }),
      },
      { USDC: 1500 }
    );

    const rate = await estimateDepositForAnchor(
      ANCHOR_A,
      { code: 'USDC', issuer: USDC_ISSUER },
      'NGN',
      '150000',
      { deps }
    );

    expect(rate.corridorId).toBe('usdc-ngn');
    expect(rate.asset).toBe(USDC_ID);
    expect(rate.fiatAmount).toBe(150000);
    // (100 - 1) * 0.98 = 97.02
    expect(rate.totalReceived).toBeCloseTo(97.02, 7);
    expect(rate.feeType).toBe('combined');
    // 150000 / 1500 = 100 USDC before fees: the figure the asset-unit limits apply to.
    expect(rate.assetAmount).toBeCloseTo(100, 7);
    expect(rate.minAmount).toBe(5);
    expect(rate.maxAmount).toBe(500);
    expect(rate.referenceSource).toBe('test USD→NGN reference');
  });

  it('throws NoDepositRateError when no reference price exists', async () => {
    const deps = makeDeps(
      { 'https://a.example.com/sep24': infoWith({ [USDC_ID]: { enabled: true } }) },
      {} // no books at all
    );

    await expect(
      estimateDepositForAnchor(ANCHOR_A, { code: 'USDC', issuer: USDC_ISSUER }, 'NGN', '150000', {
        deps,
      })
    ).rejects.toBeInstanceOf(NoDepositRateError);
  });

  it('rejects an asset the anchor explicitly disables', async () => {
    const deps = makeDeps(
      { 'https://a.example.com/sep24': infoWith({ [USDC_ID]: { enabled: false } }) },
      { USDC: 1500 }
    );

    await expect(
      estimateDepositForAnchor(ANCHOR_A, { code: 'USDC', issuer: USDC_ISSUER }, 'NGN', '150000', {
        deps,
      })
    ).rejects.toThrow('does not enable USDC deposits');
  });
  it('throws InvalidDepositAmountError for an amount that is not a positive number', async () => {
    const deps = makeDeps(
      { 'https://a.example.com/sep24': infoWith({ [USDC_ID]: { enabled: true } }) },
      { USDC: 1500 }
    );

    await expect(
      estimateDepositForAnchor(ANCHOR_A, { code: 'USDC', issuer: USDC_ISSUER }, 'NGN', 'abc', {
        deps,
      })
    ).rejects.toBeInstanceOf(InvalidDepositAmountError);
  });

  it('uses a pre-loaded /info without fetching the TOML or /info again', async () => {
    const deps = makeDeps({}, { USDC: 1500 });

    const rate = await estimateDepositForAnchor(
      ANCHOR_A,
      { code: 'USDC', issuer: USDC_ISSUER },
      'NGN',
      '150000',
      { deps, info: infoWith({ [USDC_ID]: { enabled: true } }) }
    );

    expect(rate.asset).toBe(USDC_ID);
    expect(deps.resolveAnchor).not.toHaveBeenCalled();
    expect(deps.getSep24Info).not.toHaveBeenCalled();
  });
});

describe('depositLimitStatus (#1477)', () => {
  function row(over: Partial<DepositRate>): DepositRate {
    return {
      anchorId: 'anchor-a',
      anchorName: 'Anchor A',
      corridorId: 'usdc-ngn',
      asset: USDC_ID,
      fiatAmount: 150000,
      fee: null,
      feeType: 'flat',
      exchangeRate: 0.00066,
      totalReceived: 100,
      assetAmount: 100,
      source: 'sep24-fee',
      updatedAt: new Date('2026-10-25T08:00:00.000Z'),
      ...over,
    };
  }

  it('is ok when the anchor publishes no limits', () => {
    expect(depositLimitStatus(row({}))).toBe('ok');
  });

  it('is ok when the row has no asset amount to measure', () => {
    const { assetAmount: _unused, ...withoutAmount } = row({ minAmount: 500, maxAmount: 600 });
    expect(depositLimitStatus(withoutAmount)).toBe('ok');
  });

  it('is below_min under the minimum and above_max over the maximum', () => {
    expect(depositLimitStatus(row({ minAmount: 100.01 }))).toBe('below_min');
    expect(depositLimitStatus(row({ maxAmount: 99.99 }))).toBe('above_max');
  });

  it('treats the boundaries themselves as ok', () => {
    expect(depositLimitStatus(row({ minAmount: 100 }))).toBe('ok');
    expect(depositLimitStatus(row({ maxAmount: 100 }))).toBe('ok');
    expect(depositLimitStatus(row({ minAmount: 100, maxAmount: 100 }))).toBe('ok');
  });

  it('judges asset units, not the fiat amount', () => {
    // 150000 NGN is far above a 5000 limit, but only 100 USDC is being bought.
    expect(depositLimitStatus(row({ fiatAmount: 150000, maxAmount: 5000 }))).toBe('ok');
  });

  it('only looks at one-sided limits', () => {
    expect(depositLimitStatus(row({ minAmount: 50 }))).toBe('ok');
    expect(depositLimitStatus(row({ maxAmount: 500 }))).toBe('ok');
  });
});
