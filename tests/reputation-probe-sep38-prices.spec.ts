import { describe, it, expect, vi } from 'vitest';
import { probeSep38Prices, type QuoteHistorySink } from '@/lib/reputation/probe';
import { createReputationStore } from '@/lib/reputation/store';
import type { Anchor, Sep1TomlData, Sep38IndicativePrice } from '@/types';
import type { QuoteHistoryRow } from '@/types/reputation';

// A minimal anchor serving the real registry corridors usdc-ngn (NGN) and
// usdc-kes (KES), so corridor→payout-currency resolution uses the real table.
const anchor = (over: Partial<Anchor> = {}): Anchor =>
  ({
    id: 'zeam',
    name: 'Zeam',
    homeDomain: 'zeam.example',
    corridors: ['usdc-ngn', 'usdc-kes'],
    assetCode: 'USDC',
    assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVV',
    ...over,
  }) as Anchor;

const tomlWithQuoteServer = (domain: string, quoteServer: string | undefined): Sep1TomlData =>
  ({
    domain,
    ANCHOR_QUOTE_SERVER: quoteServer,
    capabilities: { sep38: Boolean(quoteServer) },
  }) as unknown as Sep1TomlData;

const price = (buyAsset: string, p: string, total: string): Sep38IndicativePrice =>
  ({ asset: buyAsset, buy_asset: buyAsset, price: p, total_price: total }) as Sep38IndicativePrice;

function collectingSink(): { sink: QuoteHistorySink; rows: QuoteHistoryRow[] } {
  const rows: QuoteHistoryRow[] = [];
  return {
    rows,
    sink: {
      recordQuote: async (row) => {
        rows.push(row);
      },
    },
  };
}

const NOW = Date.parse('2026-10-20T12:00:00.000Z');

describe('probeSep38Prices (Q38013 / #1509)', () => {
  it('writes rows only for buy assets matching the anchor corridors', async () => {
    const { sink, rows } = collectingSink();
    const getPrices = vi.fn().mockResolvedValue([
      price('iso4217:NGN', '1601.5', '160150'),
      price('iso4217:KES', '129.4', '12940'),
      price('iso4217:EUR', '0.9', '90'), // no corridor pays out EUR: dropped
    ]);

    const returned = await probeSep38Prices(
      [anchor()],
      sink,
      {
        resolveToml: vi.fn().mockResolvedValue({
          ok: true,
          data: tomlWithQuoteServer('zeam.example', 'https://quotes.zeam.example'),
        }),
        getPrices,
        now: () => NOW,
      },
      '100'
    );

    expect(rows.map((r) => r.buyAsset).sort()).toEqual(['iso4217:KES', 'iso4217:NGN']);
    expect(returned).toEqual(rows);
    const ngn = rows.find((r) => r.buyAsset === 'iso4217:NGN');
    expect(ngn).toMatchObject({
      anchorId: 'zeam',
      corridor: 'usdc-ngn',
      sellAsset: `stellar:USDC:${anchor().assetIssuer}`,
      sellAmount: '100',
      price: '1601.5',
      totalPrice: '160150',
      source: 'sep38-prices',
      observedAt: new Date(NOW).toISOString(),
    });
    expect(getPrices).toHaveBeenCalledWith('https://quotes.zeam.example', {
      sell_asset: `stellar:USDC:${anchor().assetIssuer}`,
      sell_amount: '100',
    });
  });

  it('skips anchors without SEP-38 silently', async () => {
    const { sink, rows } = collectingSink();
    const getPrices = vi.fn();

    const returned = await probeSep38Prices([anchor({ id: 'no-quotes' })], sink, {
      resolveToml: vi
        .fn()
        .mockResolvedValue({ ok: true, data: tomlWithQuoteServer('zeam.example', undefined) }),
      getPrices,
      now: () => NOW,
    });

    expect(returned).toEqual([]);
    expect(rows).toEqual([]);
    expect(getPrices).not.toHaveBeenCalled();
  });

  it('a /prices failure on one anchor does not abort the sweep', async () => {
    const { sink, rows } = collectingSink();
    const toml = (domain: string) => ({
      ok: true as const,
      data: tomlWithQuoteServer(domain, `https://quotes.${domain}`),
    });
    const getPrices = vi
      .fn()
      .mockRejectedValueOnce(new Error('quote server down (simulated)'))
      .mockResolvedValueOnce([price('iso4217:NGN', '1600', '160000')]);

    const returned = await probeSep38Prices(
      [anchor({ id: 'broken' }), anchor({ id: 'healthy' })],
      sink,
      {
        resolveToml: vi.fn((domain: string) => Promise.resolve(toml(domain))),
        getPrices,
        now: () => NOW,
      }
    );

    expect(returned).toHaveLength(1);
    expect(rows[0]?.anchorId).toBe('healthy');
  });

  it('an unavailable toml is logged as a skip, not thrown', async () => {
    const { sink, rows } = collectingSink();
    const returned = await probeSep38Prices([anchor({ id: 'unreachable' })], sink, {
      resolveToml: vi.fn().mockResolvedValue({ ok: false, error: 'timeout (simulated)' }),
      getPrices: vi.fn(),
      now: () => NOW,
    });
    expect(returned).toEqual([]);
    expect(rows).toEqual([]);
  });

  it('counts reflect the recorded rows', async () => {
    const { sink, rows } = collectingSink();
    const returned = await probeSep38Prices([anchor()], sink, {
      resolveToml: vi.fn().mockResolvedValue({
        ok: true,
        data: tomlWithQuoteServer('zeam.example', 'https://quotes.zeam.example'),
      }),
      getPrices: vi
        .fn()
        .mockResolvedValue([
          price('iso4217:NGN', '1600', '160000'),
          price('iso4217:KES', '129', '12900'),
        ]),
      now: () => NOW,
    });
    expect(returned).toHaveLength(2);
    expect(rows).toHaveLength(2);
  });
  it('writes durable rows into the real store', async () => {
    const store = createReputationStore({ backend: 'memory' });
    await probeSep38Prices([anchor()], store, {
      resolveToml: vi.fn().mockResolvedValue({
        ok: true,
        data: tomlWithQuoteServer('zeam.example', 'https://quotes.zeam.example'),
      }),
      getPrices: vi.fn().mockResolvedValue([price('iso4217:NGN', '1600', '160000')]),
      now: () => NOW,
    });

    expect(await store.queryQuotes({ anchorId: 'zeam', corridor: 'usdc-ngn' })).toHaveLength(1);
    await store.close();
  });

  it('a rejected write is skipped, not thrown, and is not counted', async () => {
    const sink: QuoteHistorySink = {
      recordQuote: vi.fn().mockRejectedValue(new Error('store down')),
    };
    const returned = await probeSep38Prices([anchor()], sink, {
      resolveToml: vi.fn().mockResolvedValue({
        ok: true,
        data: tomlWithQuoteServer('zeam.example', 'https://quotes.zeam.example'),
      }),
      getPrices: vi.fn().mockResolvedValue([price('iso4217:NGN', '1600', '160000')]),
      now: () => NOW,
    });

    expect(returned).toEqual([]);
  });
});
