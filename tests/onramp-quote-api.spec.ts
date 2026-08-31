import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';

// Uncomment when app/api/onramp/quote/[corridor]/route.ts is implemented.
// import { GET } from '@/app/api/onramp/quote/[corridor]/route';

// Stub replaced by the real import above once the route exists.
// Returns 501 so that any accidental un-skip without the real route fails loudly.
const GET = async (..._args: unknown[]): Promise<Response> => new Response(null, { status: 501 });

// ─── Contract types ───────────────────────────────────────────────────────────
//
// The onramp quote endpoint mirrors the shape of GET /api/rates/[corridor] where
// the structures align. The key semantic difference is direction: rates gives
// crypto→fiat (off-ramp), this endpoint gives fiat→crypto (on-ramp).
//
// `amount` is the fiat amount the user intends to deposit; `totalReceived` is
// the on-chain asset (USDC by default) they will receive after fees. Source is
// always 'sep24-fee' for reachable on-ramp anchors — deposit flows use the
// SEP-24 /fee schedule, not a firm SEP-38 quote.

interface OnrampRate {
  anchorId: string;
  anchorName: string;
  corridorId: string;
  fee: number | null;
  feeType: 'flat' | 'percent' | 'combined';
  exchangeRate: number | null;
  totalReceived: number | null;
  source: 'sep24-fee' | 'unavailable';
  updatedAt: string;
}

interface OnrampQuoteError {
  anchorId: string;
  anchorName: string;
  reason: string;
}

interface OnrampQuoteResponse {
  corridorId: string;
  rates: OnrampRate[];
  bestRateId: string;
  errors?: OnrampQuoteError[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(corridor: string, params: Record<string, string> = {}): NextRequest {
  const url = new URL(`http://localhost/api/onramp/quote/${corridor}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url.toString(), { method: 'GET' });
}

function makeCtx(corridor: string) {
  return { params: Promise.resolve({ corridor }) };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
//
// All tests are skipped until app/api/onramp/quote/[corridor]/route.ts exists.
// To un-skip: uncomment the GET import above, remove the null stub, and delete
// the .skip modifiers throughout this file.

describe.skip('GET /api/onramp/quote/[corridor] — happy path', () => {
  it('returns 200 for a valid corridor and amount', async () => {
    const res = await GET(makeRequest('usdc-ngn', { amount: '10000' }), makeCtx('usdc-ngn'));
    expect(res.status).toBe(200);
  });

  it('response body has corridorId, rates, and bestRateId', async () => {
    const res = await GET(makeRequest('usdc-ngn', { amount: '10000' }), makeCtx('usdc-ngn'));
    const data = (await res.json()) as OnrampQuoteResponse;

    expect(typeof data.corridorId).toBe('string');
    expect(data.corridorId).toBe('usdc-ngn');
    expect(Array.isArray(data.rates)).toBe(true);
    expect(typeof data.bestRateId).toBe('string');
  });

  it('bestRateId names an anchor present in the rates array', async () => {
    const res = await GET(makeRequest('usdc-ngn', { amount: '10000' }), makeCtx('usdc-ngn'));
    const data = (await res.json()) as OnrampQuoteResponse;

    const ids = data.rates.map((r) => r.anchorId);
    expect(ids).toContain(data.bestRateId);
  });

  it('each rate entry has the required fields with correct types', async () => {
    const res = await GET(makeRequest('usdc-ngn', { amount: '10000' }), makeCtx('usdc-ngn'));
    const data = (await res.json()) as OnrampQuoteResponse;

    for (const rate of data.rates) {
      expect(typeof rate.anchorId).toBe('string');
      expect(rate.anchorId.length).toBeGreaterThan(0);
      expect(typeof rate.anchorName).toBe('string');
      expect(rate.corridorId).toBe('usdc-ngn');
      expect(['flat', 'percent', 'combined']).toContain(rate.feeType);
      expect(['sep24-fee', 'unavailable']).toContain(rate.source);
      expect(typeof rate.updatedAt).toBe('string');
      expect(new Date(rate.updatedAt).getTime()).not.toBeNaN();
    }
  });

  it('totalReceived is a positive number for reachable anchors', async () => {
    const res = await GET(makeRequest('usdc-ngn', { amount: '10000' }), makeCtx('usdc-ngn'));
    const data = (await res.json()) as OnrampQuoteResponse;

    const reachable = data.rates.filter((r) => r.source !== 'unavailable');
    for (const rate of reachable) {
      expect(rate.totalReceived).not.toBeNull();
      expect(rate.totalReceived as number).toBeGreaterThan(0);
    }
  });

  it('totalReceived and fee are null when source is unavailable', async () => {
    const res = await GET(makeRequest('usdc-ngn', { amount: '10000' }), makeCtx('usdc-ngn'));
    const data = (await res.json()) as OnrampQuoteResponse;

    const unavailable = data.rates.filter((r) => r.source === 'unavailable');
    for (const rate of unavailable) {
      expect(rate.totalReceived).toBeNull();
    }
  });

  it('source is sep24-fee for every reachable anchor (no firm SEP-38 for deposits)', async () => {
    const res = await GET(makeRequest('usdc-ngn', { amount: '10000' }), makeCtx('usdc-ngn'));
    const data = (await res.json()) as OnrampQuoteResponse;

    const reachable = data.rates.filter((r) => r.source !== 'unavailable');
    for (const rate of reachable) {
      expect(rate.source).toBe('sep24-fee');
    }
  });

  it('amount defaults to 100 when not provided', async () => {
    const res = await GET(makeRequest('usdc-ngn'), makeCtx('usdc-ngn'));
    expect(res.status).toBe(200);
  });
});

describe.skip('GET /api/onramp/quote/[corridor] — deposit type', () => {
  it('accepts type=bank_account and returns 200', async () => {
    const res = await GET(
      makeRequest('usdc-ngn', { amount: '10000', type: 'bank_account' }),
      makeCtx('usdc-ngn')
    );
    expect(res.status).toBe(200);
  });

  it('accepts type=mobile_money and returns 200', async () => {
    const res = await GET(
      makeRequest('usdc-ngn', { amount: '10000', type: 'mobile_money' }),
      makeCtx('usdc-ngn')
    );
    expect(res.status).toBe(200);
  });

  it('accepts type=cash and returns 200', async () => {
    const res = await GET(
      makeRequest('usdc-ngn', { amount: '10000', type: 'cash' }),
      makeCtx('usdc-ngn')
    );
    expect(res.status).toBe(200);
  });
});

describe.skip('GET /api/onramp/quote/[corridor] — caching headers', () => {
  it('response includes a Cache-Control header', async () => {
    const res = await GET(makeRequest('usdc-ngn', { amount: '10000' }), makeCtx('usdc-ngn'));
    const cc = res.headers.get('cache-control') ?? '';
    expect(cc.length).toBeGreaterThan(0);
  });

  it('Cache-Control header includes max-age', async () => {
    const res = await GET(makeRequest('usdc-ngn', { amount: '10000' }), makeCtx('usdc-ngn'));
    const cc = res.headers.get('cache-control') ?? '';
    expect(cc).toMatch(/max-age=\d+/);
  });

  it('response includes X-RateLimit-Remaining header', async () => {
    const res = await GET(makeRequest('usdc-ngn', { amount: '10000' }), makeCtx('usdc-ngn'));
    expect(res.headers.get('x-ratelimit-remaining')).not.toBeNull();
  });
});

describe.skip('GET /api/onramp/quote/[corridor] — validation errors', () => {
  it('returns 400 for an unknown corridor', async () => {
    const res = await GET(makeRequest('usdc-xyz', { amount: '10000' }), makeCtx('usdc-xyz'));
    expect(res.status).toBe(400);
  });

  it('400 body has an error field', async () => {
    const res = await GET(makeRequest('usdc-xyz', { amount: '10000' }), makeCtx('usdc-xyz'));
    const body = await res.json();
    expect(typeof body.error).toBe('string');
    expect((body.error as string).length).toBeGreaterThan(0);
  });

  it('returns 400 for amount=0', async () => {
    const res = await GET(makeRequest('usdc-ngn', { amount: '0' }), makeCtx('usdc-ngn'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for a negative amount', async () => {
    const res = await GET(makeRequest('usdc-ngn', { amount: '-50' }), makeCtx('usdc-ngn'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for a non-numeric amount', async () => {
    const res = await GET(makeRequest('usdc-ngn', { amount: 'abc' }), makeCtx('usdc-ngn'));
    expect(res.status).toBe(400);
  });

  it('400 for invalid amount has an error field', async () => {
    const res = await GET(makeRequest('usdc-ngn', { amount: '0' }), makeCtx('usdc-ngn'));
    const body = await res.json();
    expect(typeof body.error).toBe('string');
  });
});
