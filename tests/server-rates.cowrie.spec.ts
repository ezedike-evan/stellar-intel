/**
 * Regression test: Cowrie appears on usdc-ngn via SEP-6 (B009).
 *
 * Before B006 (SEP-6 Tier-3 fallback), Cowrie was silently dropped from the
 * USDC→NGN comparison because it advertises SEP-6 only (no SEP-38, no SEP-24).
 * This test locks in that fix: MSW intercepts the real SEP-6 /info HTTP call so
 * the getSep6Info parsing and fee derivation are exercised end-to-end.
 *
 * TOML resolution is mocked at the module level — stellar-sdk's
 * StellarToml.Resolver.resolve() does not use global fetch and is not
 * interceptable by MSW in the test environment.
 */

import { describe, it, expect, vi, beforeAll, afterEach, afterAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { cowrieHandlers } from './msw/handlers';
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
vi.mock('@/lib/fx/rates', () => ({ getUsdFxRate: vi.fn() }));
// getSep6Info is NOT mocked — MSW intercepts its fetch call to /info

import { fetchCorridorRates } from '@/lib/stellar/server-rates';
import { getAnchorsByCorridorId } from '@/lib/stellar/anchors';
import { resolveAnchor } from '@/lib/stellar/sep1';
import { assertSep38Capable } from '@/lib/stellar/sep38';
import { getSep24Info } from '@/lib/stellar/sep24';
import { getUsdFxRate } from '@/lib/fx/rates';

const server = setupServer(...cowrieHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
});
afterAll(() => server.close());

const cowrieAnchor: Anchor = {
  id: 'cowrie',
  name: 'Cowrie Exchange',
  homeDomain: 'cowrie.exchange',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
};

const cowrieToml = {
  TRANSFER_SERVER: 'https://cowrie.exchange/sep6',
  TRANSFER_SERVER_SEP0024: null,
  ANCHOR_QUOTE_SERVER: null,
  capabilities: { sep6: true, sep10: true, sep24: false, sep38: false, sep12: false },
} as unknown as Sep1TomlData;

describe('fetchCorridorRates — Cowrie appears on usdc-ngn via SEP-6 (B009)', () => {
  beforeEach(() => {
    vi.mocked(getAnchorsByCorridorId).mockReturnValue([cowrieAnchor]);
    vi.mocked(resolveAnchor).mockResolvedValue(cowrieToml);
    vi.mocked(assertSep38Capable).mockImplementation(() => {
      throw new Error('no SEP-38');
    });
    vi.mocked(getSep24Info).mockRejectedValue(new Error('no SEP-24'));
    vi.mocked(getUsdFxRate).mockResolvedValue(1550);
  });

  it('returns a rate row for Cowrie on the usdc-ngn corridor', async () => {
    const result = await fetchCorridorRates('usdc-ngn', '100');

    expect(result.rates).toHaveLength(1);
    expect(result.rates[0]?.anchorId).toBe('cowrie');
  });

  it('sources the rate from the SEP-6 /info fee path', async () => {
    const result = await fetchCorridorRates('usdc-ngn', '100');

    expect(result.rates[0]?.source).toBe('sep6-fee');
  });

  it('computes totalReceived using MSW-served fee_fixed=2 and FX rate 1550', async () => {
    const result = await fetchCorridorRates('usdc-ngn', '100');

    // sellAmount=100, fee_fixed=2 → net=98; 98 × 1550 = 151900
    expect(result.rates[0]?.totalReceived).toBeCloseTo(151900);
  });

  it('does not push Cowrie to errors[]', async () => {
    const result = await fetchCorridorRates('usdc-ngn', '100');

    expect(result.errors.find((e) => e.anchorId === 'cowrie')).toBeUndefined();
  });

  it('regresses the pre-B006 silent-drop: rates[] is non-empty', async () => {
    const result = await fetchCorridorRates('usdc-ngn', '100');

    expect(result.rates.length).toBeGreaterThan(0);
    expect(result.bestRateId).toBe('cowrie');
  });
});
