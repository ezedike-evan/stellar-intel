import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getSep38Price } from '@/lib/stellar/sep38';

const QUOTE_SERVER = 'https://anchor.example/sep38';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('getSep38Price', () => {
  it('fetches an indicative price from a mock SEP-38 anchor', async () => {
    let capturedUrl = '';
    let capturedOptions: RequestInit | undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
        capturedUrl = String(url);
        capturedOptions = options;

        return jsonResponse({
          price: '1580.50',
          total_price: '1579.00',
          sell_amount: '100.0000000',
          buy_amount: '157900.00',
          fee: {
            total: '1.50',
            asset: 'iso4217:NGN',
            details: [
              {
                name: 'bank_fee',
                amount: '1.50',
                description: 'Local bank transfer fee',
              },
            ],
          },
        });
      })
    );

    const price = await getSep38Price({
      quoteServer: QUOTE_SERVER,
      sell_asset: 'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      buy_asset: 'iso4217:NGN',
      sell_amount: '100',
      buy_delivery_method: 'bank_account',
      context: 'sep6',
    });

    const url = new URL(capturedUrl);

    expect(url.origin + url.pathname).toBe(`${QUOTE_SERVER}/price`);
    expect(url.searchParams.get('sell_asset')).toBe(
      'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
    );
    expect(url.searchParams.get('buy_asset')).toBe('iso4217:NGN');
    expect(url.searchParams.get('sell_amount')).toBe('100');
    expect(url.searchParams.get('buy_delivery_method')).toBe('bank_account');
    expect(url.searchParams.get('context')).toBe('sep6');
    expect(capturedOptions?.headers).toEqual({ Accept: 'application/json' });
    expect(price).toEqual({
      price: '1580.50',
      total_price: '1579.00',
      sell_amount: '100.0000000',
      buy_amount: '157900.00',
      fee: {
        total: '1.50',
        asset: 'iso4217:NGN',
        details: [
          {
            name: 'bank_fee',
            amount: '1.50',
            description: 'Local bank transfer fee',
          },
        ],
      },
    });
  });

  it('normalizes anchor error bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'pair not supported', code: 'no_market' }, 400))
    );

    await expect(
      getSep38Price({
        quoteServer: QUOTE_SERVER,
        sell_asset: 'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        buy_asset: 'iso4217:NGN',
        sell_amount: '100',
        buy_delivery_method: 'bank_account',
        context: 'sep6',
      })
    ).rejects.toMatchObject({
      name: 'SepError',
      message: 'pair not supported',
      code: 'no_market',
      httpStatus: 400,
    });
  });
});
