import { describe, it, expect, vi } from 'vitest';
import { getAllSep38Readiness, getSep38Readiness } from '@/lib/stellar/sep38-readiness';
import { ANCHORS } from '@/constants/anchors';
import type { Anchor, Sep38Info } from '@/types';

const ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

function anchor(over: Partial<Anchor> = {}): Anchor {
  return {
    id: 'test-anchor',
    name: 'Test Anchor',
    homeDomain: 'home.example.com',
    corridors: ['usdc-ngn'],
    assetCode: 'USDC',
    assetIssuer: ISSUER,
    seps: ['sep10', 'sep24'],
    ...over,
  } as Anchor;
}

function info(...assets: string[]): Sep38Info {
  return {
    assets: assets.map((asset) => ({
      asset,
      sellDeliveryMethods: [],
      buyDeliveryMethods: [],
      countryCodes: [],
    })),
  };
}

describe('getSep38Readiness (#1504)', () => {
  it('reports no quote server when the toml advertises none', async () => {
    const getInfo = vi.fn();
    const result = await getSep38Readiness(anchor(), {
      resolveToml: async () => ({ ANCHOR_QUOTE_SERVER: null }),
      getInfo,
    });

    expect(result).toMatchObject({
      anchorId: 'test-anchor',
      declared: false,
      quoteServer: null,
      infoReachable: false,
      assets: [],
      sellsRegisteredAsset: false,
      error: null,
    });
    expect(getInfo).not.toHaveBeenCalled();
  });

  it('reads /info and reports the assets and whether the registered one is sold', async () => {
    const result = await getSep38Readiness(anchor({ seps: ['sep38'] }), {
      resolveToml: async () => ({ ANCHOR_QUOTE_SERVER: 'https://quotes.example.com' }),
      getInfo: async () => info(`stellar:USDC:${ISSUER}`, 'iso4217:NGN'),
    });

    expect(result).toMatchObject({
      declared: true,
      quoteServer: 'https://quotes.example.com',
      infoReachable: true,
      assets: [`stellar:USDC:${ISSUER}`, 'iso4217:NGN'],
      sellsRegisteredAsset: true,
      error: null,
    });
    expect(Date.parse(result.checkedAt)).not.toBeNaN();
  });

  it('is not selling the registered asset when only another is listed', async () => {
    const result = await getSep38Readiness(anchor(), {
      resolveToml: async () => ({ ANCHOR_QUOTE_SERVER: 'https://quotes.example.com' }),
      getInfo: async () => info('stellar:USDC:GOTHERISSUER', 'iso4217:NGN'),
    });

    expect(result.infoReachable).toBe(true);
    expect(result.sellsRegisteredAsset).toBe(false);
  });

  it('keeps the quote server and reports the error when /info fails', async () => {
    const result = await getSep38Readiness(anchor(), {
      resolveToml: async () => ({ ANCHOR_QUOTE_SERVER: 'https://quotes.example.com' }),
      getInfo: async () => {
        throw new Error('HTTP 500 from https://quotes.example.com SEP-38 /info endpoint');
      },
    });

    expect(result.quoteServer).toBe('https://quotes.example.com');
    expect(result.infoReachable).toBe(false);
    expect(result.assets).toEqual([]);
    expect(result.error).toContain('HTTP 500');
  });

  it('reports a toml failure instead of throwing', async () => {
    const result = await getSep38Readiness(anchor(), {
      resolveToml: async () => {
        throw new Error('stellar.toml not found');
      },
      getInfo: vi.fn(),
    });

    expect(result.quoteServer).toBeNull();
    expect(result.error).toContain('stellar.toml not found');
  });

  it('reports a declared-but-not-advertised mismatch', async () => {
    const result = await getSep38Readiness(anchor({ seps: ['sep38'] }), {
      resolveToml: async () => ({ ANCHOR_QUOTE_SERVER: null }),
    });

    expect(result.declared).toBe(true);
    expect(result.quoteServer).toBeNull();
  });

  it('resolves the toml from serviceDomain when the anchor has one', async () => {
    const resolveToml = vi.fn(async () => ({ ANCHOR_QUOTE_SERVER: null }));

    await getSep38Readiness(anchor({ serviceDomain: 'service.example.com' }), { resolveToml });
    await getSep38Readiness(anchor(), { resolveToml });

    expect(resolveToml).toHaveBeenNthCalledWith(1, 'service.example.com');
    expect(resolveToml).toHaveBeenNthCalledWith(2, 'home.example.com');
  });

  it('treats a blank quote server as not advertised', async () => {
    const result = await getSep38Readiness(anchor(), {
      resolveToml: async () => ({ ANCHOR_QUOTE_SERVER: '   ' }),
    });
    expect(result.quoteServer).toBeNull();
  });
});

describe('getAllSep38Readiness', () => {
  it('checks every registered anchor, concurrently, and never rejects', async () => {
    let inFlight = 0;
    let peak = 0;
    const resolveToml = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      throw new Error('down');
    });

    const results = await getAllSep38Readiness({ resolveToml });

    expect(results.map((r) => r.anchorId)).toEqual(ANCHORS.map((a) => a.id));
    expect(results.every((r) => r.error !== null)).toBe(true);
    expect(peak).toBeGreaterThan(1);
  });
});
