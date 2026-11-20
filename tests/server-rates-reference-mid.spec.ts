import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Anchor, Corridor, Sep1TomlData } from '@/types';
import { USDC_ASSET } from '@/constants/anchors';

vi.mock('@/lib/stellar/anchors', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/stellar/anchors')>();
  return {
    ...actual,
    getAnchorsByCorridorId: vi.fn(),
    getCorridorById: vi.fn(),
    getCorridorAsset: vi.fn(),
  };
});
vi.mock('@/lib/stellar/sep1', () => ({ resolveAnchor: vi.fn() }));
vi.mock('@/lib/stellar/sep38', () => ({
  assertSep38Capable: vi.fn(),
  getSep38Price: vi.fn(),
}));
vi.mock('@/lib/stellar/sep24', () => ({ getSep24Info: vi.fn() }));
vi.mock('@/lib/stellar/sep6', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/stellar/sep6')>();
  return {
    ...actual,
    getSep6Info: vi.fn(),
  };
});
vi.mock('@/lib/fx/rates', () => ({ getUsdFxRate: vi.fn(), getFxRate: vi.fn() }));
vi.mock('@/lib/stellar/horizon', () => ({ getOrderBook: vi.fn() }));
vi.mock('@/lib/reputation/scores', () => ({
  fetchReputationScores: vi.fn().mockResolvedValue(new Map()),
}));

import { fetchCorridorRates } from '@/lib/stellar/server-rates';
import { getAnchorsByCorridorId, getCorridorById, getCorridorAsset } from '@/lib/stellar/anchors';
import { resolveAnchor } from '@/lib/stellar/sep1';
import { assertSep38Capable } from '@/lib/stellar/sep38';
import { getSep24Info } from '@/lib/stellar/sep24';
import { getSep6Info } from '@/lib/stellar/sep6';
import { getFxRate, getUsdFxRate } from '@/lib/fx/rates';
import { getOrderBook } from '@/lib/stellar/horizon';

const USDC_ISSUER = USDC_ASSET.issuer ?? '';

const usdcCorridor: Corridor = {
  id: 'usdc-ngn',
  from: 'USDC',
  fromIssuer: USDC_ISSUER || null,
  fromPeg: 'USD',
  to: 'NGN',
  countryCode: 'NG',
  countryName: 'Nigeria',
};

const usdcAnchor: Anchor = {
  id: 'moneygram',
  name: 'MoneyGram',
  homeDomain: 'stellar.moneygram.com',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: USDC_ISSUER,
  seps: ['sep24'],
};

const usdcToml = {
  domain: 'stellar.moneygram.com',
  TRANSFER_SERVER_SEP0024: 'https://moneygram.com/sep24',
  TRANSFER_SERVER: null,
  ANCHOR_QUOTE_SERVER: null,
  WEB_AUTH_ENDPOINT: null,
  SIGNING_KEY: null,
  NETWORK_PASSPHRASE: null,
  ORG_URL: null,
  ORG_SUPPORT_EMAIL: null,
  ORG_SUPPORT_URL: null,
  CURRENCIES: [],
  capabilities: {
    sep10: false,
    sep24: true,
    sep38: false,
    sep12: false,
    sep6: false,
    sep31: false,
  },
  seps: ['sep24'],
} as unknown as Sep1TomlData;

const xlmCorridor: Corridor = {
  id: 'xlm-ngn',
  from: 'XLM',
  fromIssuer: null,
  fromPeg: 'USD',
  to: 'NGN',
  countryCode: 'NG',
  countryName: 'Nigeria',
};

const xlmAnchor: Anchor = {
  id: 'test-xlm',
  name: 'XLM Test Anchor',
  homeDomain: 'xlm.example.com',
  corridors: ['xlm-ngn'],
  assetCode: 'XLM',
  assetIssuer: '',
  seps: ['sep24'],
};

const xlmToml = {
  domain: 'xlm.example.com',
  TRANSFER_SERVER_SEP0024: 'https://xlm.example.com/sep24',
  TRANSFER_SERVER: null,
  ANCHOR_QUOTE_SERVER: null,
  WEB_AUTH_ENDPOINT: null,
  SIGNING_KEY: null,
  NETWORK_PASSPHRASE: null,
  ORG_URL: null,
  ORG_SUPPORT_EMAIL: null,
  ORG_SUPPORT_URL: null,
  CURRENCIES: [],
  capabilities: {
    sep10: false,
    sep24: true,
    sep38: false,
    sep12: false,
    sep6: false,
    sep31: false,
  },
  seps: ['sep24'],
} as unknown as Sep1TomlData;

const bookFixture = (bids: number[], asks: number[]) => ({
  bids: bids.map((price) => ({ price, amount: 1_000 })),
  asks: asks.map((price) => ({ price, amount: 1_000 })),
});

describe('server-rates reference mid (Q38017 / ANC015)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertSep38Capable).mockImplementation(() => {
      throw new Error('no SEP-38');
    });
  });

  it('USDC row produces unchanged numbers and carries referenceSource: "fx"', async () => {
    vi.mocked(getAnchorsByCorridorId).mockReturnValue([usdcAnchor]);
    vi.mocked(getCorridorById).mockReturnValue(usdcCorridor);
    vi.mocked(getCorridorAsset).mockReturnValue({
      code: 'USDC',
      issuer: USDC_ISSUER || null,
      peg: 'USD',
    });
    vi.mocked(resolveAnchor).mockResolvedValue(usdcToml);
    vi.mocked(getSep24Info).mockResolvedValue({
      withdraw: {
        USDC: { enabled: true, fee_fixed: 2, fee_percent: 0 },
      },
    } as unknown as Awaited<ReturnType<typeof getSep24Info>>);
    vi.mocked(getFxRate).mockResolvedValue(1600);
    vi.mocked(getUsdFxRate).mockResolvedValue(1600);

    const result = await fetchCorridorRates('usdc-ngn', '100');

    expect(result.errors).toHaveLength(0);
    expect(result.rates).toHaveLength(1);
    const rate = result.rates[0];
    expect(rate).toBeDefined();
    expect(rate!.anchorId).toBe('moneygram');
    expect(rate!.source).toBe('sep24-fee');
    expect(rate!.referenceSource).toBe('fx');
    expect(rate!.referenceDetail).toBe('USDC treated as 1 USD × open.er-api USD→NGN');
    // Net: (100 - 2) * 1600 = 156800
    expect(rate!.totalReceived).toBeCloseTo(156800);
    expect(rate!.exchangeRate).toBeCloseTo(1568);
    expect(rate!.fee).toBe(2);
    expect(rate!.feeType).toBe('flat');
  });

  it('a non-USD asset uses the SDEX mid and carries referenceSource: "sdex+fx"', async () => {
    vi.mocked(getAnchorsByCorridorId).mockReturnValue([xlmAnchor]);
    vi.mocked(getCorridorById).mockReturnValue(xlmCorridor);
    vi.mocked(getCorridorAsset).mockReturnValue({
      code: 'XLM',
      issuer: null,
      peg: 'USD',
    });
    vi.mocked(resolveAnchor).mockResolvedValue(xlmToml);
    vi.mocked(getSep24Info).mockResolvedValue({
      withdraw: {
        XLM: { enabled: true, fee_fixed: 1, fee_percent: 0 },
      },
    } as unknown as Awaited<ReturnType<typeof getSep24Info>>);

    // Bid 0.118, ask 0.122 -> mid 0.12 USDC per XLM; spread ≈ 3.3% <= 5%
    vi.mocked(getOrderBook).mockResolvedValue(bookFixture([0.118], [0.122]));
    vi.mocked(getUsdFxRate).mockResolvedValue(1600);
    vi.mocked(getFxRate).mockResolvedValue(1600);

    const result = await fetchCorridorRates('xlm-ngn', '100');

    expect(result.errors).toHaveLength(0);
    expect(result.rates).toHaveLength(1);
    const rate = result.rates[0];
    expect(rate).toBeDefined();
    expect(rate!.anchorId).toBe('test-xlm');
    expect(rate!.source).toBe('sep24-fee');
    expect(rate!.referenceSource).toBe('sdex+fx');
    expect(rate!.referenceDetail).toBe('SDEX XLM/USDC mid 0.12 × open.er-api USD→NGN');
    // Net: (100 - 1) * (0.12 * 1600) = 99 * 192 = 19008
    expect(rate!.totalReceived).toBeCloseTo(19008);
    expect(rate!.exchangeRate).toBeCloseTo(190.08);
    expect(rate!.fee).toBe(1);
  });

  it('a reference failure puts the anchor in errors with the reason', async () => {
    vi.mocked(getAnchorsByCorridorId).mockReturnValue([xlmAnchor]);
    vi.mocked(getCorridorById).mockReturnValue(xlmCorridor);
    vi.mocked(getCorridorAsset).mockReturnValue({
      code: 'XLM',
      issuer: null,
      peg: 'USD',
    });
    vi.mocked(resolveAnchor).mockResolvedValue(xlmToml);
    vi.mocked(getSep24Info).mockResolvedValue({
      withdraw: {
        XLM: { enabled: true, fee_fixed: 1, fee_percent: 0 },
      },
    } as unknown as Awaited<ReturnType<typeof getSep24Info>>);

    // Spread wider than 5% limit: bid 0.10, ask 0.12 -> spread 18.2%
    vi.mocked(getOrderBook).mockResolvedValue(bookFixture([0.1], [0.12]));
    vi.mocked(getUsdFxRate).mockResolvedValue(1600);

    const result = await fetchCorridorRates('xlm-ngn', '100');

    expect(result.rates).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.anchorId).toBe('test-xlm');
    expect(result.errors[0]?.reason).toContain('spread is 18.2%, wider than the 5% limit');
  });

  it('an empty SDEX order book puts the anchor in errors with the reason', async () => {
    vi.mocked(getAnchorsByCorridorId).mockReturnValue([xlmAnchor]);
    vi.mocked(getCorridorById).mockReturnValue(xlmCorridor);
    vi.mocked(getCorridorAsset).mockReturnValue({
      code: 'XLM',
      issuer: null,
      peg: 'USD',
    });
    vi.mocked(resolveAnchor).mockResolvedValue(xlmToml);
    vi.mocked(getSep24Info).mockResolvedValue({
      withdraw: {
        XLM: { enabled: true, fee_fixed: 1, fee_percent: 0 },
      },
    } as unknown as Awaited<ReturnType<typeof getSep24Info>>);

    // Empty bid side
    vi.mocked(getOrderBook).mockResolvedValue(bookFixture([], [0.12]));
    vi.mocked(getUsdFxRate).mockResolvedValue(1600);

    const result = await fetchCorridorRates('xlm-ngn', '100');

    expect(result.rates).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.anchorId).toBe('test-xlm');
    expect(result.errors[0]?.reason).toContain(
      'SDEX order book against USDC is empty on the bid side'
    );
  });

  it('SEP-6 indicative estimate carries referenceSource and referenceDetail', async () => {
    const sep6Toml = {
      ...xlmToml,
      TRANSFER_SERVER_SEP0024: null,
      TRANSFER_SERVER: 'https://xlm.example.com/sep6',
      capabilities: { ...xlmToml.capabilities, sep24: false, sep6: true },
      seps: ['sep6'],
    } as unknown as Sep1TomlData;

    vi.mocked(getAnchorsByCorridorId).mockReturnValue([xlmAnchor]);
    vi.mocked(getCorridorById).mockReturnValue(xlmCorridor);
    vi.mocked(getCorridorAsset).mockReturnValue({
      code: 'XLM',
      issuer: null,
      peg: 'USD',
    });
    vi.mocked(resolveAnchor).mockResolvedValue(sep6Toml);
    vi.mocked(getSep6Info).mockResolvedValue({
      enabled: true,
      feeFixed: 2,
      feePercent: 0,
      min: 1,
      max: 10000,
      fields: {} as any,
    });
    vi.mocked(getOrderBook).mockResolvedValue(bookFixture([0.118], [0.122]));
    vi.mocked(getUsdFxRate).mockResolvedValue(1600);
    vi.mocked(getFxRate).mockResolvedValue(1600);

    const result = await fetchCorridorRates('xlm-ngn', '100');

    expect(result.errors).toHaveLength(0);
    expect(result.rates).toHaveLength(1);
    const rate = result.rates[0];
    expect(rate).toBeDefined();
    expect(rate!.source).toBe('sep6-fee');
    expect(rate!.referenceSource).toBe('sdex+fx');
    expect(rate!.referenceDetail).toBe('SDEX XLM/USDC mid 0.12 × open.er-api USD→NGN');
    // Net: (100 - 2) * (0.12 * 1600) = 98 * 192 = 18816
    expect(rate!.totalReceived).toBeCloseTo(18816);
  });
});
