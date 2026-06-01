import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSep38Info, _clearSep38Cache } from '@/lib/stellar/sep38';

const QUOTE_SERVER = 'https://anchor.example.com/sep38';

// A representative real SEP-38 GET /info response (mirrors the shape in the SEP-38
// spec: an on-chain Stellar asset plus an off-chain fiat asset with delivery methods).
const REAL_INFO_RESPONSE = {
  assets: [
    {
      asset: 'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    },
    {
      asset: 'iso4217:BRL',
      country_codes: ['BRA'],
      sell_delivery_methods: [
        {
          name: 'cash',
          description: 'Deposit cash BRL at one of our agent locations.',
        },
        {
          name: 'ACH',
          description: "Send BRL directly to the Anchor's bank account.",
        },
        {
          name: 'PIX',
          description: "Send BRL directly to the Anchor's bank account.",
        },
      ],
      buy_delivery_methods: [
        {
          name: 'cash',
          description: 'Pick up cash BRL at one of our payout locations.',
        },
        {
          name: 'ACH',
          description: 'Have BRL sent directly to your bank account.',
        },
        {
          name: 'PIX',
          description: 'Have BRL sent directly to the account of your choice.',
        },
      ],
    },
  ],
};

function mockFetch(response: unknown, init?: { ok?: boolean; status?: number }) {
  const fn = vi.fn(async () => ({
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => response,
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  _clearSep38Cache();
  vi.restoreAllMocks();
});

describe('getSep38Info', () => {
  it('parses a real SEP-38 anchor /info response cleanly', async () => {
    mockFetch(REAL_INFO_RESPONSE);

    const info = await getSep38Info(QUOTE_SERVER);

    expect(info.assets).toHaveLength(2);

    const usdc = info.assets[0];
    const brl = info.assets[1];

    expect(usdc).toEqual({
      asset: 'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      sellDeliveryMethods: [],
      buyDeliveryMethods: [],
      countryCodes: [],
    });

    expect(brl?.asset).toBe('iso4217:BRL');
    expect(brl?.countryCodes).toEqual(['BRA']);
    expect(brl?.sellDeliveryMethods).toEqual([
      { name: 'cash', description: 'Deposit cash BRL at one of our agent locations.' },
      { name: 'ACH', description: "Send BRL directly to the Anchor's bank account." },
      { name: 'PIX', description: "Send BRL directly to the Anchor's bank account." },
    ]);
    expect(brl?.buyDeliveryMethods.map((m) => m.name)).toEqual(['cash', 'ACH', 'PIX']);
  });

  it('requests the /info path on the quote server', async () => {
    const fetchFn = mockFetch(REAL_INFO_RESPONSE);

    await getSep38Info(QUOTE_SERVER);

    expect(fetchFn).toHaveBeenCalledWith(
      'https://anchor.example.com/sep38/info',
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it('strips a trailing slash from the quote server before appending /info', async () => {
    const fetchFn = mockFetch(REAL_INFO_RESPONSE);

    await getSep38Info('https://anchor.example.com/sep38/');

    expect(fetchFn).toHaveBeenCalledWith(
      'https://anchor.example.com/sep38/info',
      expect.anything()
    );
  });

  it('caches the response for 10 minutes and does not refetch', async () => {
    const fetchFn = mockFetch(REAL_INFO_RESPONSE);

    await getSep38Info(QUOTE_SERVER);
    await getSep38Info(QUOTE_SERVER);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('refetches once the cache TTL has expired', async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = mockFetch(REAL_INFO_RESPONSE);

      await getSep38Info(QUOTE_SERVER);
      vi.advanceTimersByTime(10 * 60 * 1000 + 1);
      await getSep38Info(QUOTE_SERVER);

      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws a descriptive error on a non-2xx response', async () => {
    mockFetch({}, { ok: false, status: 502 });

    await expect(getSep38Info(QUOTE_SERVER)).rejects.toThrow(/HTTP 502.*SEP-38 \/info/);
  });

  it('returns an empty asset list when the response has no assets', async () => {
    mockFetch({});

    const info = await getSep38Info(QUOTE_SERVER);
    expect(info.assets).toEqual([]);
  });

  it('skips malformed asset entries and delivery methods', async () => {
    mockFetch({
      assets: [
        { asset: 'iso4217:NGN', sell_delivery_methods: [{ description: 'no name' }, 42] },
        { missing: 'asset field' },
        'not an object',
      ],
    });

    const info = await getSep38Info(QUOTE_SERVER);

    expect(info.assets).toHaveLength(1);
    expect(info.assets[0]?.asset).toBe('iso4217:NGN');
    expect(info.assets[0]?.sellDeliveryMethods).toEqual([]);
  });

  it('rejects an empty quote server URL', async () => {
    await expect(getSep38Info('   ')).rejects.toThrow(/Quote server URL is required/);
  });
});
