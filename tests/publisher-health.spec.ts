import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/publisher/health/route';
import { checkRateLimit, clearRateLimitStore } from '@/lib/api/rate-limit';

function makeRequest(headers: HeadersInit): NextRequest {
  return new NextRequest('http://localhost/api/publisher/health', { headers });
}

beforeEach(() => {
  clearRateLimitStore();
});

describe('GET /api/publisher/health — rate limiting', () => {
  it('succeeds while under the api.publisher.health limit', async () => {
    const headers = { 'x-forwarded-for': '198.51.100.10' };
    for (let i = 0; i < 119; i++) {
      const res = await GET(makeRequest(headers));
      expect(res.status).toBe(200);
    }
  });

  it('returns 429 with Retry-After once the bucket is exhausted', async () => {
    const ip = '198.51.100.20';
    for (let i = 0; i < 120; i++) {
      await checkRateLimit(ip, { bucket: 'api.publisher.health', maxRequests: 120 });
    }

    const res = await GET(makeRequest({ 'x-forwarded-for': ip }));

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');

    const body = (await res.json()) as { error: string; retryAfter: number };
    expect(body.error).toBe('Too many requests');
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  it('rate-limits independently per IP', async () => {
    const exhaustedIp = '198.51.100.30';
    for (let i = 0; i < 120; i++) {
      await checkRateLimit(exhaustedIp, { bucket: 'api.publisher.health', maxRequests: 120 });
    }

    const blocked = await GET(makeRequest({ 'x-forwarded-for': exhaustedIp }));
    expect(blocked.status).toBe(429);

    const otherIpRes = await GET(makeRequest({ 'x-forwarded-for': '198.51.100.31' }));
    expect(otherIpRes.status).toBe(200);
  });
});
