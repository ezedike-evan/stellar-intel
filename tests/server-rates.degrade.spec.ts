/**
 * Per-anchor graceful degradation (B058).
 *
 * A single misbehaving anchor must never break a corridor render: its failure is
 * captured in `errors[]` and the surviving anchors are still quoted and ranked.
 * The chaos case here injects an anchor that *throws* on property access — the
 * pathological failure the per-anchor guard exists to isolate — and asserts the
 * corridor still resolves with the healthy anchor's rate.
 *
 * Everything is mocked; the suite performs no network I/O.
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

import { fetchCorridorRates } from '@/lib/stellar/server-rates';
import { getAnchorsByCorridorId } from '@/lib/stellar/anchors';
import { resolveAnchor } from '@/lib/stellar/sep1';
import { assertSep38Capable, getSep38Price } from '@/lib/stellar/sep38';

const healthyAnchor: Anchor = {
  id: 'healthy',
  name: 'Healthy Anchor',
  homeDomain: 'healthy.test',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
};

/**
 * A malformed anchor whose `name` getter throws. When TOML resolution rejects
 * for it, the inner error handler reads `anchor.name` while building its error
 * entry — so the throw escapes every per-tier catch and can only be contained by
 * the top-level per-anchor guard. Without that guard it rejects Promise.all and
 * takes the whole corridor down with it.
 */
const poisonAnchor = {
  id: 'poison',
  get name(): string {
    throw new Error('poison anchor: name getter exploded');
  },
  homeDomain: 'poison.test',
  corridors: ['usdc-ngn'],
  assetCode: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
} as unknown as Anchor;

beforeEach(() => {
  vi.mocked(getAnchorsByCorridorId).mockReturnValue([healthyAnchor, poisonAnchor]);

  // Healthy anchor resolves; the poison anchor's TOML rejects, which triggers
  // the inner error handler to read its throwing `name`.
  vi.mocked(resolveAnchor).mockImplementation(async (domain: string) => {
    if (domain === 'healthy.test') {
      return { TRANSFER_SERVER_SEP0024: 'https://healthy.test/sep24' } as Sep1TomlData;
    }
    throw new Error(`no TOML for ${domain}`);
  });

  // Healthy anchor produces a firm SEP-38 quote.
  vi.mocked(assertSep38Capable).mockReturnValue('https://healthy.test/sep38');
  vi.mocked(getSep38Price).mockResolvedValue({
    buy_amount: '160000',
    sell_amount: '100',
    price: '1600',
    total_price: '1600',
  });
});

describe('fetchCorridorRates — graceful per-anchor degradation', () => {
  it('renders the surviving anchor when another throws on property access', async () => {
    const result = await fetchCorridorRates('usdc-ngn', '100');

    expect(result.rates).toHaveLength(1);
    expect(result.rates[0]?.anchorId).toBe('healthy');
    expect(result.rates[0]?.totalReceived).toBe(160000);
    expect(result.bestRateId).toBe('healthy');
  });

  it('captures the throwing anchor in errors[] rather than dropping it silently', async () => {
    const result = await fetchCorridorRates('usdc-ngn', '100');

    const poisonError = result.errors.find((e) => e.anchorId === 'poison');
    expect(poisonError).toBeDefined();
    expect(poisonError?.reason).toContain('poison anchor');
  });

  it('does not reject even when every anchor throws', async () => {
    vi.mocked(getAnchorsByCorridorId).mockReturnValue([poisonAnchor]);

    const result = await fetchCorridorRates('usdc-ngn', '100');

    expect(result.rates).toHaveLength(0);
    expect(result.bestRateId).toBe('');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.anchorId).toBe('poison');
  });
});
