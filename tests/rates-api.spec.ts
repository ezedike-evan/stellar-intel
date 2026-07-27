import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { checkRateLimit, clearRateLimitStore } from '@/lib/api/rate-limit';

vi.mock('@/lib/stellar/server-rates', () => ({
  fetchCorridorRates: vi.fn().mockResolvedValue({ rates: [], errors: [] }),
}));

import { GET } from '@/app/api/rates/[corridor]/route';

function makeRequest(url: string, headers?: HeadersInit): NextRequest {
  return headers ? new NextRequest(url, { headers }) : new NextRequest(url);
}

describe('GET /api/rates/[corridor]', () => {
  beforeEach(() => {
    clearRateLimitStore();
  });

  it('sets a 15s shared cache with 60s stale-while-revalidate on a successful response', async () => {
    const res = await GET(makeRequest('http://localhost/api/rates/usdc-ngn?amount=100'), {
      params: { corridor: 'usdc-ngn' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=15, stale-while-revalidate=60');
  });

  it('does not cache a 400 response for an invalid corridor', async () => {
    const res = await GET(makeRequest('http://localhost/api/rates/not-a-corridor'), {
      params: { corridor: 'not-a-corridor' },
    });

    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).not.toBe(
      'public, max-age=15, stale-while-revalidate=60'
    );
  });

  it('returns 429 when the rates bucket is exhausted', async () => {
    for (let i = 0; i < 90; i++) {
      checkRateLimit('9.9.9.9', { bucket: 'api.rates', maxRequests: 90 });
    }

    const res = await GET(
      makeRequest('http://localhost/api/rates/usdc-ngn?amount=100', {
        'x-forwarded-for': '9.9.9.9',
      }),
      { params: { corridor: 'usdc-ngn' } }
    );

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
  });
});
