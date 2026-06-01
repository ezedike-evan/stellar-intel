import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSep38Prices, Sep38ParseError, _clearSep38Cache } from '@/lib/stellar/sep38';

const QUOTE_SERVER = 'https://anchor.example.com/sep38';
const USDC = 'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

// A representative real SEP-38 GET /prices response: buy_assets each carry an
// asset identifier, an indicative price string and (ignored) decimals.
const REAL_PRICES_RESPONSE = {
  buy_assets: [
    { asset: 'iso4217:BRL', price: '0.18', decimals: 2 },
    { asset: 'iso4217:NGN', price: '0.0011', decimals: 2 },
  ],
};

let lastUrl = '';

function mockFetch(response: unknown, init?: { ok?: boolean; status?: number }) {
  const fn = vi.fn((url: string) => {
    lastUrl = url;
    return Promise.resolve({
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      json: async () => response,
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  lastUrl = '';
  _clearSep38Cache();
  vi.restoreAllMocks();
});

describe('getSep38Prices', () => {
  it('parses a real SEP-38 /prices response against the schema', async () => {
    mockFetch(REAL_PRICES_RESPONSE);

    const prices = await getSep38Prices(QUOTE_SERVER, {
      sell_asset: USDC,
      sell_amount: '100',
    });

    expect(prices).toEqual([
      { asset: 'iso4217:BRL', buy_asset: 'iso4217:BRL', price: '0.18', total_price: '0.18' },
      { asset: 'iso4217:NGN', buy_asset: 'iso4217:NGN', price: '0.0011', total_price: '0.0011' },
    ]);
  });

  it('honors an explicit total_price when the anchor provides one', async () => {
    mockFetch({
      buy_assets: [{ asset: 'iso4217:BRL', price: '0.18', total_price: '0.185' }],
    });

    const prices = await getSep38Prices(QUOTE_SERVER, { sell_asset: USDC, sell_amount: '100' });

    expect(prices[0]?.total_price).toBe('0.185');
    expect(prices[0]?.price).toBe('0.18');
  });

  it('builds the /prices URL with required and optional query params', async () => {
    mockFetch(REAL_PRICES_RESPONSE);

    await getSep38Prices(QUOTE_SERVER, {
      sell_asset: USDC,
      sell_amount: '100',
      buy_delivery_method: 'PIX',
      country_code: 'BRA',
    });

    expect(lastUrl.startsWith('https://anchor.example.com/sep38/prices?')).toBe(true);
    expect(lastUrl).toContain(`sell_asset=${encodeURIComponent(USDC)}`);
    expect(lastUrl).toContain('sell_amount=100');
    expect(lastUrl).toContain('buy_delivery_method=PIX');
    expect(lastUrl).toContain('country_code=BRA');
  });

  it('strips a trailing slash from the quote server', async () => {
    mockFetch(REAL_PRICES_RESPONSE);

    await getSep38Prices('https://anchor.example.com/sep38/', {
      sell_asset: USDC,
      sell_amount: '100',
    });

    expect(lastUrl).toContain('https://anchor.example.com/sep38/prices?');
  });

  it('does not cache indicative prices (refetches every call)', async () => {
    const fetchFn = mockFetch(REAL_PRICES_RESPONSE);

    await getSep38Prices(QUOTE_SERVER, { sell_asset: USDC, sell_amount: '100' });
    await getSep38Prices(QUOTE_SERVER, { sell_asset: USDC, sell_amount: '100' });

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('throws a typed Sep38ParseError when buy_assets is missing', async () => {
    mockFetch({ unexpected: true });

    await expect(
      getSep38Prices(QUOTE_SERVER, { sell_asset: USDC, sell_amount: '100' })
    ).rejects.toBeInstanceOf(Sep38ParseError);
  });

  it('throws a typed Sep38ParseError when an entry is missing its price', async () => {
    mockFetch({ buy_assets: [{ asset: 'iso4217:BRL' }] });

    await expect(
      getSep38Prices(QUOTE_SERVER, { sell_asset: USDC, sell_amount: '100' })
    ).rejects.toThrow(Sep38ParseError);
  });

  it('throws a typed Sep38ParseError when an entry is missing its asset', async () => {
    mockFetch({ buy_assets: [{ price: '0.18' }] });

    await expect(
      getSep38Prices(QUOTE_SERVER, { sell_asset: USDC, sell_amount: '100' })
    ).rejects.toBeInstanceOf(Sep38ParseError);
  });

  it('throws a descriptive error on a non-2xx response', async () => {
    mockFetch({}, { ok: false, status: 500 });

    await expect(
      getSep38Prices(QUOTE_SERVER, { sell_asset: USDC, sell_amount: '100' })
    ).rejects.toThrow(/HTTP 500.*SEP-38 \/prices/);
  });

  it('rejects an empty sell_asset with a Sep38ParseError', async () => {
    mockFetch(REAL_PRICES_RESPONSE);

    await expect(
      getSep38Prices(QUOTE_SERVER, { sell_asset: '', sell_amount: '100' })
    ).rejects.toBeInstanceOf(Sep38ParseError);
  });

  it('rejects an empty sell_amount with a Sep38ParseError', async () => {
    mockFetch(REAL_PRICES_RESPONSE);

    await expect(
      getSep38Prices(QUOTE_SERVER, { sell_asset: USDC, sell_amount: '' })
    ).rejects.toBeInstanceOf(Sep38ParseError);
  });
});
