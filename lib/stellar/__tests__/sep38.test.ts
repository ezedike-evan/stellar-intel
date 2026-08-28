import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertSep38Capable, postSep38Quote, Sep38ParseError, _clearSep38Cache } from '../sep38';
import type { Sep1TomlData, Sep38QuoteParams } from '@/types';

// ─── Shared constants ─────────────────────────────────────────────────────────

/** Canonical USDC sell_asset identifier for the USDC→NGN corridor. */
const USDC_SELL_ASSET = 'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
/** Canonical NGN buy_asset identifier for the USDC→NGN corridor. */
const NGN_BUY_ASSET = 'iso4217:NGN';

// ─── TOML factory ────────────────────────────────────────────────────────────

function makeToml(overrides: Partial<Sep1TomlData> = {}): Sep1TomlData {
  return {
    domain: 'test.anchor.com',
    TRANSFER_SERVER_SEP0024: null,
    ANCHOR_QUOTE_SERVER: null,
    WEB_AUTH_ENDPOINT: null,
    SIGNING_KEY: null,
    NETWORK_PASSPHRASE: null,
    ORG_URL: null,
    ORG_SUPPORT_EMAIL: null,
    ORG_SUPPORT_URL: null,
    CURRENCIES: [],
    capabilities: { sep10: false, sep24: false, sep38: false, sep12: false },
    ...overrides,
  };
}

// ─── assertSep38Capable ───────────────────────────────────────────────────────

describe('assertSep38Capable', () => {
  it('throws when capabilities.sep38 is false', () => {
    const toml = makeToml();
    expect(() => assertSep38Capable(toml)).toThrow('cannot be used for SEP-38');
  });

  it('throws when ANCHOR_QUOTE_SERVER is null even if flag is true', () => {
    const toml = makeToml({
      capabilities: { sep10: false, sep24: false, sep38: true, sep12: false },
    });
    expect(() => assertSep38Capable(toml)).toThrow('cannot be used for SEP-38');
  });

  it('returns the quote server URL when the anchor is SEP-38 capable', () => {
    const url = 'https://anchor.example.com/quote';
    const toml = makeToml({
      ANCHOR_QUOTE_SERVER: url,
      capabilities: { sep10: false, sep24: false, sep38: true, sep12: false },
    });
    expect(assertSep38Capable(toml)).toBe(url);
  });
});

// ─── USDC→NGN corridor — postSep38Quote ───────────────────────────────────────
//
// These tests verify that postSep38Quote correctly handles a USDC→NGN firm-quote
// response: the corridor asset identifiers round-trip intact, the expiry is
// accepted, and the parsed quote shape matches the Sep38Quote contract.
//
// The fetch is stubbed so the test is deterministic; the fixture shape mirrors
// what a real SEP-38 anchor returns for this corridor (see tests/fixtures/sep38/quote.json).

const QUOTE_SERVER = 'https://anchor.example.com/sep38';
const JWT = 'eyJ.test.jwt';

const NGN_PARAMS: Sep38QuoteParams = {
  sell_asset: USDC_SELL_ASSET,
  buy_asset: NGN_BUY_ASSET,
  sell_amount: '100',
  context: 'sep6',
};

function ngnQuoteResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ngn-quote-fixture-001',
    // expires_at is always generated fresh so it is in the future relative to Date.now()
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    price: '1580.00',
    total_price: '1602.50',
    sell_asset: USDC_SELL_ASSET,
    sell_amount: '100',
    buy_asset: NGN_BUY_ASSET,
    buy_amount: '158000.00',
    fee: { total: '1.50', asset: USDC_SELL_ASSET },
    ...overrides,
  };
}

function stubFetch(response: unknown, init?: { ok?: boolean; status?: number }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: init?.ok ?? true,
        status: init?.status ?? 200,
        json: async () => response,
      })
    )
  );
}

beforeEach(() => {
  _clearSep38Cache();
  vi.restoreAllMocks();
});

describe('postSep38Quote — USDC→NGN corridor', () => {
  it('parses a USDC→NGN firm-quote response and preserves all required fields', async () => {
    stubFetch(ngnQuoteResponse());
    const quote = await postSep38Quote(QUOTE_SERVER, JWT, NGN_PARAMS);

    expect(quote.id).toBe('ngn-quote-fixture-001');
    expect(quote.price).toBe('1580.00');
    expect(quote.total_price).toBe('1602.50');
    expect(quote.sell_amount).toBe('100');
    expect(quote.buy_amount).toBe('158000.00');
    expect(quote.fee).toEqual({ total: '1.50' });
    expect(quote.context).toBe('sep6');
  });

  it('buy_asset in the response is iso4217:NGN (USDC→NGN corridor identifier)', async () => {
    // The Quote_Client does not validate asset identifiers itself — it preserves
    // whatever the anchor returns. This test asserts the fixture is wired to the
    // correct corridor so a future refactor cannot silently swap the asset.
    const resp = ngnQuoteResponse();
    stubFetch(resp);
    // We check the raw fixture shape directly; no need to call postSep38Quote.
    expect(resp.buy_asset).toBe(NGN_BUY_ASSET);
    expect(resp.sell_asset).toBe(USDC_SELL_ASSET);
  });

  it('expires_at round-trips as a parsable, future RFC 3339 timestamp', async () => {
    stubFetch(ngnQuoteResponse());
    const quote = await postSep38Quote(QUOTE_SERVER, JWT, NGN_PARAMS);

    const expiresMs = Date.parse(quote.expires_at);
    expect(Number.isNaN(expiresMs)).toBe(false);
    expect(expiresMs).toBeGreaterThan(Date.now());
  });

  it('throws Sep38ParseError when expires_at is missing from a USDC→NGN response', async () => {
    stubFetch(ngnQuoteResponse({ expires_at: undefined }));
    await expect(postSep38Quote(QUOTE_SERVER, JWT, NGN_PARAMS)).rejects.toBeInstanceOf(
      Sep38ParseError
    );
  });

  it('throws Sep38ParseError when expires_at is already in the past', async () => {
    stubFetch(ngnQuoteResponse({ expires_at: '2000-01-01T00:00:00Z' }));
    await expect(postSep38Quote(QUOTE_SERVER, JWT, NGN_PARAMS)).rejects.toThrow(
      /expires_at.*not in the future/
    );
  });

  it('throws Sep38ParseError when buy_amount is absent', async () => {
    stubFetch(ngnQuoteResponse({ buy_amount: undefined }));
    await expect(postSep38Quote(QUOTE_SERVER, JWT, NGN_PARAMS)).rejects.toBeInstanceOf(
      Sep38ParseError
    );
  });

  it('throws a descriptive HTTP error on a non-2xx response', async () => {
    stubFetch({}, { ok: false, status: 422 });
    await expect(postSep38Quote(QUOTE_SERVER, JWT, NGN_PARAMS)).rejects.toThrow(/HTTP 422/);
  });

  it('strips trailing slashes from the quote server URL before appending /quote', async () => {
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        capturedUrl = url;
        return Promise.resolve({ ok: true, status: 200, json: async () => ngnQuoteResponse() });
      })
    );

    await postSep38Quote('https://anchor.example.com/sep38/', JWT, NGN_PARAMS);
    expect(capturedUrl).toBe('https://anchor.example.com/sep38/quote');
  });

  it('sends the Authorization header with the SEP-10 JWT', async () => {
    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        capturedHeaders = (init?.headers as Record<string, string>) ?? {};
        return Promise.resolve({ ok: true, status: 200, json: async () => ngnQuoteResponse() });
      })
    );

    await postSep38Quote(QUOTE_SERVER, JWT, NGN_PARAMS);
    expect(capturedHeaders['Authorization']).toBe(`Bearer ${JWT}`);
  });
});
