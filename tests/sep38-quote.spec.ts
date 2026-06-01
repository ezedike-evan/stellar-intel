import { beforeEach, describe, expect, it, vi } from 'vitest';
import { postSep38Quote, Sep38ParseError, _clearSep38Cache } from '@/lib/stellar/sep38';
import type { Sep38QuoteParams } from '@/types';

const QUOTE_SERVER = 'https://anchor.example.com/sep38';
const JWT = 'eyJ.fake.jwt';
const USDC = 'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const PARAMS: Sep38QuoteParams = {
  sell_asset: USDC,
  buy_asset: 'iso4217:BRL',
  sell_amount: '500',
  buy_delivery_method: 'PIX',
  context: 'sep31',
};

// A representative real SEP-38 POST /quote response. expires_at is generated per
// test so it is always in the future relative to "now".
function quoteResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'de762cda-a193-4961-861e-57b31fed6eb3',
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    total_price: '5.42',
    price: '5.00',
    sell_asset: USDC,
    sell_amount: '500',
    buy_asset: 'iso4217:BRL',
    buy_amount: '92.25',
    fee: { total: '0.00', asset: USDC },
    ...overrides,
  };
}

let lastUrl = '';
let lastInit: RequestInit | undefined;

function mockFetch(response: unknown, init?: { ok?: boolean; status?: number }) {
  const fn = vi.fn((url: string, reqInit?: RequestInit) => {
    lastUrl = url;
    lastInit = reqInit;
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
  lastInit = undefined;
  _clearSep38Cache();
  vi.restoreAllMocks();
});

describe('postSep38Quote', () => {
  it('parses a real /quote response and exposes the firm-quote fields', async () => {
    mockFetch(quoteResponse());

    const quote = await postSep38Quote(QUOTE_SERVER, JWT, PARAMS);

    expect(quote).toEqual({
      id: 'de762cda-a193-4961-861e-57b31fed6eb3',
      expires_at: expect.any(String),
      price: '5.00',
      sell_amount: '500',
      buy_amount: '92.25',
    });
  });

  it('returns a quote whose expires_at is parsable and in the future', async () => {
    mockFetch(quoteResponse());

    const quote = await postSep38Quote(QUOTE_SERVER, JWT, PARAMS);

    const expiresMs = Date.parse(quote.expires_at);
    expect(Number.isNaN(expiresMs)).toBe(false);
    expect(expiresMs).toBeGreaterThan(Date.now());
  });

  it('POSTs to /quote with the SEP-10 JWT and a JSON body', async () => {
    mockFetch(quoteResponse());

    await postSep38Quote(QUOTE_SERVER, JWT, PARAMS);

    expect(lastUrl).toBe('https://anchor.example.com/sep38/quote');
    expect(lastInit?.method).toBe('POST');

    const headers = lastInit?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${JWT}`);
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(String(lastInit?.body));
    expect(body).toMatchObject({
      sell_asset: USDC,
      buy_asset: 'iso4217:BRL',
      sell_amount: '500',
      buy_delivery_method: 'PIX',
      context: 'sep31',
    });
  });

  it('strips a trailing slash from the quote server', async () => {
    mockFetch(quoteResponse());

    await postSep38Quote('https://anchor.example.com/sep38/', JWT, PARAMS);

    expect(lastUrl).toBe('https://anchor.example.com/sep38/quote');
  });

  it('requires a SEP-10 JWT', async () => {
    mockFetch(quoteResponse());

    await expect(postSep38Quote(QUOTE_SERVER, '', PARAMS)).rejects.toThrow(/JWT is required/);
  });

  it('requires sell_asset, buy_asset and sell_amount', async () => {
    mockFetch(quoteResponse());

    await expect(postSep38Quote(QUOTE_SERVER, JWT, { ...PARAMS, buy_asset: '' })).rejects.toThrow(
      /sell_asset, buy_asset and sell_amount are required/
    );
  });

  it('throws Sep38ParseError when a required field is missing', async () => {
    mockFetch(quoteResponse({ id: undefined }));

    await expect(postSep38Quote(QUOTE_SERVER, JWT, PARAMS)).rejects.toBeInstanceOf(Sep38ParseError);
  });

  it('throws Sep38ParseError when buy_amount is missing', async () => {
    mockFetch(quoteResponse({ buy_amount: undefined }));

    await expect(postSep38Quote(QUOTE_SERVER, JWT, PARAMS)).rejects.toBeInstanceOf(Sep38ParseError);
  });

  it('throws Sep38ParseError when expires_at is not a valid timestamp', async () => {
    mockFetch(quoteResponse({ expires_at: 'not-a-date' }));

    await expect(postSep38Quote(QUOTE_SERVER, JWT, PARAMS)).rejects.toThrow(
      /expires_at.*not a valid timestamp/
    );
  });

  it('throws Sep38ParseError when expires_at is in the past', async () => {
    mockFetch(quoteResponse({ expires_at: '2000-01-01T00:00:00Z' }));

    await expect(postSep38Quote(QUOTE_SERVER, JWT, PARAMS)).rejects.toThrow(
      /expires_at.*not in the future/
    );
  });

  it('throws a descriptive error on a non-2xx response', async () => {
    mockFetch({}, { ok: false, status: 403 });

    await expect(postSep38Quote(QUOTE_SERVER, JWT, PARAMS)).rejects.toThrow(
      /HTTP 403.*SEP-38 \/quote/
    );
  });
});
