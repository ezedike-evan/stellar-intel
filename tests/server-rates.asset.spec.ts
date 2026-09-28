/**
 * Unverified payout flag (ANC037).
 *
 * Anchors serving corridors whose payout currency has not been confirmed on a
 * live /info (see Anchor.unverifiedCorridors) must have their rates labelled
 * with `unverifiedPayout: true`. Verified corridors omit the field entirely.
 *
 * Everything is mocked; the suite performs no network I/O.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Anchor, Corridor, Sep1TomlData } from '@/types';

vi.mock('@/lib/stellar/anchors', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/stellar/anchors')>();
  return { ...actual, getAnchorsByCorridorId: vi.fn(), getCorridorById: vi.fn() };
});
vi.mock('@/lib/stellar/sep1', () => ({ resolveAnchor: vi.fn() }));
vi.mock('@/lib/stellar/sep38', () => ({
  assertSep38Capable: vi.fn(),
  getSep38Price: vi.fn(),
}));
vi.mock('@/lib/stellar/sep24', () => ({ getSep24Info: vi.fn() }));
vi.mock('@/lib/fx/rates', () => ({ getUsdFxRate: vi.fn() }));

import { fetchCorridorRates } from '@/lib/stellar/server-rates';
import { getAnchorsByCorridorId, getCorridorById } from '@/lib/stellar/anchors';
import { resolveAnchor } from '@/lib/stellar/sep1';
import { assertSep38Capable, getSep38Price } from '@/lib/stellar/sep38';
import { getSep24Info } from '@/lib/stellar/sep24';
import { getUsdFxRate } from '@/lib/fx/rates';

const ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const corridor: Corridor = {
  id: 'usdc-zar',
  from: 'USDC',
  fromIssuer: ISSUER,
  fromPeg: 'USD',
  to: 'ZAR',
  countryCode: 'ZA',
  countryName: 'South Africa',
};

const unverifiedAnchor: Anchor = {
  id: 'zeam',
  name: 'Zeam Money',
  homeDomain: 'zeam.money',
  corridors: ['usdc-zar'],
  unverifiedCorridors: ['usdc-zar'],
  assetCode: 'USDC',
  assetIssuer: ISSUER,
  seps: ['sep10', 'sep24', 'sep31', 'sep38'],
};

const verifiedAnchor: Anchor = {
  id: 'moneygram',
  name: 'MoneyGram',
  homeDomain: 'stellar.moneygram.com',
  corridors: ['usdc-zar'],
  assetCode: 'USDC',
  assetIssuer: ISSUER,
  seps: ['sep10', 'sep24'],
};

const goodToml = {
  domain: 'zeam.money',
  TRANSFER_SERVER_SEP0024: 'https://zeam.money/sep24',
  TRANSFER_SERVER: 'https://zeam.money/sep6',
  ANCHOR_QUOTE_SERVER: 'https://zeam.money/sep38',
  WEB_AUTH_ENDPOINT: null,
  SIGNING_KEY: null,
  NETWORK_PASSPHRASE: null,
  ORG_URL: null,
  ORG_SUPPORT_EMAIL: null,
  ORG_SUPPORT_URL: null,
  CURRENCIES: [],
  capabilities: { sep10: true, sep24: true, sep38: true, sep12: false, sep6: true },
  seps: ['sep10', 'sep24', 'sep38'],
} as unknown as Sep1TomlData;

const goodPrice = {
  buy_amount: '1800',
  sell_amount: '100',
  price: '18',
  total_price: '18',
};

const goodSep24Info = {
  withdraw: { USDC: { enabled: true, fee_fixed: 0, fee_percent: 0 } },
} as unknown as Awaited<ReturnType<typeof getSep24Info>>;

beforeEach(() => {
  vi.mocked(getCorridorById).mockReturnValue(corridor);
  vi.mocked(resolveAnchor).mockResolvedValue(goodToml);
  vi.mocked(assertSep38Capable).mockReturnValue('https://zeam.money/sep38');
  vi.mocked(getSep38Price).mockResolvedValue(goodPrice);
  vi.mocked(getSep24Info).mockResolvedValue(goodSep24Info);
  vi.mocked(getUsdFxRate).mockResolvedValue(18);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('fetchCorridorRates — unverifiedPayout flag (ANC037)', () => {
  it("sets unverifiedPayout: true for an anchor with unverifiedCorridors: ['usdc-zar']", async () => {
    vi.mocked(getAnchorsByCorridorId).mockReturnValue([unverifiedAnchor]);

    const result = await fetchCorridorRates('usdc-zar', '100');

    expect(result.rates).toHaveLength(1);
    expect(result.rates[0]?.anchorId).toBe('zeam');
    expect(result.rates[0]?.unverifiedPayout).toBe(true);
  });

  it('omits unverifiedPayout for a normal anchor', async () => {
    vi.mocked(getAnchorsByCorridorId).mockReturnValue([verifiedAnchor]);

    const result = await fetchCorridorRates('usdc-zar', '100');

    expect(result.rates).toHaveLength(1);
    expect(result.rates[0]?.anchorId).toBe('moneygram');
    expect(result.rates[0]?.unverifiedPayout).toBeUndefined();
    expect('unverifiedPayout' in (result.rates[0] as object)).toBe(false);
  });

  it('sets the flag on the Tier-2 indicative fallback as well', async () => {
    vi.mocked(getAnchorsByCorridorId).mockReturnValue([unverifiedAnchor]);
    vi.mocked(assertSep38Capable).mockImplementation(() => {
      throw new Error('no SEP-38');
    });

    const result = await fetchCorridorRates('usdc-zar', '100');

    expect(result.rates).toHaveLength(1);
    expect(result.rates[0]?.source).toBe('sep24-fee');
    expect(result.rates[0]?.unverifiedPayout).toBe(true);
  });
});
