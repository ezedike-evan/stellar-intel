/**
 * SEP-6 Tier-3 fallback in fetchCorridorRates (B006).
 *
 * Cowrie-style anchors advertise SEP-6 but not SEP-38 or SEP-24 (for the
 * corridor in question). Without Tier-3 they silently land in errors[]. With
 * it they appear in rates[] using a live FX × SEP-6-fee estimate.
 *
 * All network I/O is mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Anchor, Sep1TomlData } from '@/types';

vi.mock('@/lib/stellar/anchors', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/stellar/anchors')>();
  return { ...actual, getAnchorsByCorridorId: vi.fn() };
});
vi.mock('@/lib/stellar/sep1', () => ({ resolveAnchor: vi.fn() }));
vi.mock('@/lib/stellar/sep38', () => ({
  assertSep38Capable: vi.fn(),
  getSep38Price: vi.fn(),
}));
vi.mock('@/lib/stellar/sep24', () => ({ getSep24Info: vi.fn() }));
vi.mock('@/lib/stellar/sep6', () => ({ getSep6Info: vi.fn() }));
vi.mock('@/lib/fx/rates', () => ({ getUsdFxRate: vi.fn() }));

import { fetchCorridorRates } from '@/lib/stellar/server-rates';
import { getAnchorsByCorridorId } from '@/lib/stellar/anchors';
import { resolveAnchor } from '@/lib/stellar/sep1';
import { assertSep38Capable } from '@/lib/stellar/sep38';
import { getSep24Info } from '@/lib/stellar/sep24';
import { getSep6Info } from '@/lib/stellar/sep6';
import { getUsdFxRate } from '@/lib/fx/rates';

const sep6OnlyAnchor: Anchor = {
  id: 'cowrie',
  name: 'Cowrie',
  homeDomain: 'cowrie.exchange',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
};

const sep6Toml = {
  TRANSFER_SERVER: 'https://cowrie.exchange/sep6',
  TRANSFER_SERVER_SEP0024: null,
  ANCHOR_QUOTE_SERVER: null,
  capabilities: { sep6: true, sep10: true, sep24: false, sep38: false, sep12: false },
} as unknown as Sep1TomlData;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAnchorsByCorridorId).mockReturnValue([sep6OnlyAnchor]);
  vi.mocked(resolveAnchor).mockResolvedValue(sep6Toml);
  vi.mocked(assertSep38Capable).mockImplementation(() => {
    throw new Error('no SEP-38');
  });
  vi.mocked(getSep24Info).mockRejectedValue(new Error('no SEP-24'));
  vi.mocked(getSep6Info).mockResolvedValue({
    enabled: true,
    feeFixed: 2,
    feePercent: 0,
    min: 10,
    max: 10000,
    fields: {},
  });
  vi.mocked(getUsdFxRate).mockResolvedValue(1550);
});

describe('fetchCorridorRates — SEP-6 Tier-3 fallback', () => {
  it('returns a rate for a SEP-6-only anchor when Tier-1 and Tier-2 fail', async () => {
    const result = await fetchCorridorRates('usdc-ngn', '100');

    expect(result.rates).toHaveLength(1);
    expect(result.rates[0]?.anchorId).toBe('cowrie');
    expect(result.rates[0]?.source).toBe('sep6-fee');
  });

  it('computes totalReceived from SEP-6 fees and FX rate', async () => {
    const result = await fetchCorridorRates('usdc-ngn', '100');
    // sellAmount=100, feeFixed=2 → net=98; 98 * 1550 = 151900
    expect(result.rates[0]?.totalReceived).toBeCloseTo(151900);
  });

  it('does not push to errors[] when Tier-3 succeeds', async () => {
    const result = await fetchCorridorRates('usdc-ngn', '100');
    expect(result.errors).toHaveLength(0);
  });

  it('still captures anchor in errors[] when all three tiers fail', async () => {
    vi.mocked(getSep6Info).mockRejectedValue(new Error('sep6 /info unavailable'));

    const result = await fetchCorridorRates('usdc-ngn', '100');

    expect(result.rates).toHaveLength(0);
    const cowrieError = result.errors.find((e) => e.anchorId === 'cowrie');
    expect(cowrieError).toBeDefined();
    expect(cowrieError?.reason).toContain('SEP-6');
  });

  it('skips Tier-3 for anchors without SEP-6 capability', async () => {
    vi.mocked(resolveAnchor).mockResolvedValue({
      ...sep6Toml,
      capabilities: { ...sep6Toml.capabilities, sep6: false },
      TRANSFER_SERVER: null,
    });

    const result = await fetchCorridorRates('usdc-ngn', '100');

    expect(vi.mocked(getSep6Info)).not.toHaveBeenCalled();
    expect(result.rates).toHaveLength(0);
    const err = result.errors.find((e) => e.anchorId === 'cowrie');
    expect(err?.reason).not.toContain('SEP-6');
  });
});
