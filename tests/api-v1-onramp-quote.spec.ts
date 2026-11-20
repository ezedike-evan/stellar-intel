import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DepositRate, DepositRateComparison } from '@/types';

vi.mock('@/lib/api/rate-limit', () => ({
  getClientIp: () => '127.0.0.1',
  checkRateLimit: async () => ({
    allowed: true,
    remaining: 59,
    resetAt: Date.now() + 60_000,
    retryAfter: 0,
  }),
}));

const fetchDepositRates = vi.fn();
vi.mock('@/lib/stellar/deposit-rates', () => ({
  fetchDepositRates: (...args: unknown[]) => fetchDepositRates(...args),
}));

import { GET } from '@/app/api/v1/onramp/quote/route';

const ASSET = 'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

function rate(over: Partial<DepositRate> = {}): DepositRate {
  return {
    anchorId: 'anchor-a',
    anchorName: 'Anchor A',
    corridorId: 'usdc-ngn',
    asset: ASSET,
    fiatAmount: 10000,
    fee: 1,
    feeType: 'flat',
    exchangeRate: 0.00064,
    totalReceived: 6.4,
    source: 'sep24-fee',
    updatedAt: new Date('2026-10-25T08:00:00.000Z'),
    ...over,
  };
}

function comparison(rates: DepositRate[]): DepositRateComparison {
  return {
    corridorId: 'usdc-ngn',
    direction: 'deposit',
    rates,
    bestRateId: rates.find((r) => r.totalReceived !== null)?.anchorId ?? '',
    errors: [],
  };
}

function call(query: Record<string, string>) {
  const url = new URL('http://localhost/api/v1/onramp/quote');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return GET(new Request(url) as never);
}

const OK = { corridor: 'usdc-ngn', amount: '10000' };

beforeEach(() => {
  fetchDepositRates.mockReset();
  fetchDepositRates.mockResolvedValue(comparison([rate()]));
});

describe('GET /api/v1/onramp/quote (#1471)', () => {
  it('returns the rates with ISO dates, indicative and a disclaimer', async () => {
    const res = await call(OK);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.corridorId).toBe('usdc-ngn');
    expect(body.direction).toBe('deposit');
    expect(body.rates[0].updatedAt).toBe('2026-10-25T08:00:00.000Z');
    expect(body.indicative).toBe(true);
    expect(body.disclaimer).toBe(
      'Estimate only. The anchor sets the final rate in its deposit window.'
    );
  });

  it('passes the amount, funding type and asset to fetchDepositRates', async () => {
    await call({ ...OK, type: 'mobile_money', asset: ASSET });
    expect(fetchDepositRates).toHaveBeenCalledWith('usdc-ngn', '10000', {
      type: 'mobile_money',
      asset: ASSET,
    });
  });

  it('defaults the funding type to bank_account', async () => {
    await call(OK);
    expect(fetchDepositRates).toHaveBeenCalledWith('usdc-ngn', '10000', { type: 'bank_account' });
  });

  it('sets a short public Cache-Control and the rate-limit headers', async () => {
    const res = await call(OK);
    expect(res.headers.get('cache-control')).toBe('public, max-age=15, stale-while-revalidate=30');
    expect(res.headers.get('x-ratelimit-remaining')).toBe('59');
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it.each([
    ['an unknown corridor', { corridor: 'usdc-xyz', amount: '10000' }],
    ['a missing corridor', { amount: '10000' }],
    ['amount=0', { corridor: 'usdc-ngn', amount: '0' }],
    ['a negative amount', { corridor: 'usdc-ngn', amount: '-50' }],
    ['a non-numeric amount', { corridor: 'usdc-ngn', amount: 'abc' }],
    ['a missing amount', { corridor: 'usdc-ngn' }],
    ['more than 7 decimal places', { corridor: 'usdc-ngn', amount: '1.12345678' }],
    ['a bad type', { corridor: 'usdc-ngn', amount: '10', type: 'crypto' }],
    ['a malformed asset', { corridor: 'usdc-ngn', amount: '10', asset: 'USDC' }],
  ])('rejects %s with a validation_error 400', async (_label, query) => {
    const res = await call(query);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('validation_error');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.requestId).toBeTruthy();
    expect(fetchDepositRates).not.toHaveBeenCalled();
  });

  it('accepts seven decimal places', async () => {
    const res = await call({ ...OK, amount: '1.1234567' });
    expect(res.status).toBe(200);
  });

  it('answers 502 in the envelope when the rate lookup throws', async () => {
    fetchDepositRates.mockRejectedValue(new Error('boom'));
    const res = await call(OK);
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error.code).toBe('upstream_unavailable');
    expect(JSON.stringify(body)).not.toContain('boom');
  });

  // Cases carried over from the retired tests/onramp-quote-api.spec.ts (#1472).
  describe('row semantics', () => {
    const rows = [
      rate({ anchorId: 'anchor-a', totalReceived: 6.4 }),
      rate({
        anchorId: 'anchor-b',
        source: 'unavailable',
        fee: null,
        exchangeRate: null,
        totalReceived: null,
      }),
    ];

    beforeEach(() => {
      fetchDepositRates.mockResolvedValue(comparison(rows));
    });

    it('bestRateId names an anchor present in rates', async () => {
      const body = await (await call(OK)).json();
      expect(body.rates.map((r: DepositRate) => r.anchorId)).toContain(body.bestRateId);
    });

    it('reachable rows have a positive totalReceived', async () => {
      const body = await (await call(OK)).json();
      const reachable = body.rates.filter((r: DepositRate) => r.source !== 'unavailable');
      expect(reachable.length).toBeGreaterThan(0);
      for (const r of reachable) expect(r.totalReceived).toBeGreaterThan(0);
    });

    it('unavailable rows have a null totalReceived', async () => {
      const body = await (await call(OK)).json();
      const unavailable = body.rates.filter((r: DepositRate) => r.source === 'unavailable');
      expect(unavailable.length).toBeGreaterThan(0);
      for (const r of unavailable) expect(r.totalReceived).toBeNull();
    });

    it.each(['bank_account', 'mobile_money', 'cash'])('accepts type=%s', async (type) => {
      const res = await call({ ...OK, type });
      expect(res.status).toBe(200);
    });
  });
});
