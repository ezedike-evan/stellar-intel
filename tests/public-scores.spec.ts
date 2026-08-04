import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, clearRateLimitStore } from '@/lib/api/rate-limit';
import { GET } from '@/app/v1/public/scores/route';
import { NextRequest } from 'next/server';

describe('Rate limiting', () => {
  beforeEach(() => {
    clearRateLimitStore();
  });

  it('allows first request', async () => {
    const result = await checkRateLimit('1.2.3.4');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(59);
  });

  it('supports stricter route-specific buckets', async () => {
    const options = { bucket: 'api.intent.offramp', maxRequests: 2 };
    expect((await checkRateLimit('1.2.3.4', options)).allowed).toBe(true);
    expect((await checkRateLimit('1.2.3.4', options)).allowed).toBe(true);
    expect((await checkRateLimit('1.2.3.4', options)).allowed).toBe(false);

    const defaultBucket = await checkRateLimit('1.2.3.4');
    expect(defaultBucket.allowed).toBe(true);
    expect(defaultBucket.remaining).toBe(59);
  });

  it('returns 429 after 60 requests', async () => {
    for (let i = 0; i < 60; i++) {
      await checkRateLimit('1.2.3.5');
    }
    const result = await checkRateLimit('1.2.3.5');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('different IPs have independent limits', async () => {
    for (let i = 0; i < 60; i++) {
      await checkRateLimit('10.0.0.1');
    }
    const result = await checkRateLimit('10.0.0.2');
    expect(result.allowed).toBe(true);
  });

  it('provides Retry-After > 0 when rate limited', async () => {
    for (let i = 0; i < 61; i++) {
      await checkRateLimit('5.5.5.5');
    }
    const result = await checkRateLimit('5.5.5.5');
    expect(result.retryAfter).toBeGreaterThan(0);
  });
});

describe('Lock mechanism', () => {
  it('acquires lock on first call', async () => {
    const { acquireLock, releaseLock } = await import('@/lib/reputation/lock');
    const acquired = await acquireLock('test-lock');
    expect(acquired).toBe(true);
    await releaseLock('test-lock');
  });

  it('blocks second acquisition while locked', async () => {
    const { acquireLock, releaseLock } = await import('@/lib/reputation/lock');
    await acquireLock('test-lock-2');
    const second = await acquireLock('test-lock-2');
    expect(second).toBe(false);
    await releaseLock('test-lock-2');
  });

  it('allows re-acquisition after release', async () => {
    const { acquireLock, releaseLock } = await import('@/lib/reputation/lock');
    await acquireLock('test-lock-3');
    await releaseLock('test-lock-3');
    const reacquired = await acquireLock('test-lock-3');
    expect(reacquired).toBe(true);
    await releaseLock('test-lock-3');
  });
});

describe('GET /v1/public/scores — route rate limiting', () => {
  beforeEach(() => {
    clearRateLimitStore();
  });

  it('succeeds while under the default rate limit', async () => {
    const headers = { 'x-forwarded-for': '192.0.2.10' };
    for (let i = 0; i < 59; i++) {
      const res = await GET(new NextRequest('http://localhost/v1/public/scores', { headers }));
      expect(res.status).toBe(200);
    }
  });

  it('returns 429 with Retry-After once the bucket is exhausted', async () => {
    const ip = '192.0.2.20';
    for (let i = 0; i < 60; i++) {
      await checkRateLimit(ip);
    }

    const res = await GET(
      new NextRequest('http://localhost/v1/public/scores', {
        headers: { 'x-forwarded-for': ip },
      })
    );

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');

    const body = (await res.json()) as { error: string; retryAfter: number };
    expect(body.error).toBe('Too many requests');
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  it('rate-limits independently per IP', async () => {
    const exhaustedIp = '192.0.2.30';
    for (let i = 0; i < 60; i++) {
      await checkRateLimit(exhaustedIp);
    }

    const blocked = await GET(
      new NextRequest('http://localhost/v1/public/scores', {
        headers: { 'x-forwarded-for': exhaustedIp },
      })
    );
    expect(blocked.status).toBe(429);

    const otherIpRes = await GET(
      new NextRequest('http://localhost/v1/public/scores', {
        headers: { 'x-forwarded-for': '192.0.2.31' },
      })
    );
    expect(otherIpRes.status).toBe(200);
  });
});

describe('ETag cache deduplication', () => {
  it('returns consistent ETag for identical payload', async () => {
    const request = new NextRequest('http://localhost/v1/public/scores', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });

    const response1 = await GET(request);
    const etag1 = response1.headers.get('ETag');

    const response2 = await GET(request);
    const etag2 = response2.headers.get('ETag');

    expect(etag1).toBe(etag2);
    expect(etag1).toMatch(/^"[A-Za-z0-9+/=]+"$/);
  });

  it('returns 304 when If-None-Match matches current ETag', async () => {
    const request = new NextRequest('http://localhost/v1/public/scores', {
      headers: { 'x-forwarded-for': '1.2.3.5' },
    });

    const firstResponse = await GET(request);
    const etag = firstResponse.headers.get('ETag');
    expect(etag).not.toBeNull();

    const cachedRequest = new NextRequest('http://localhost/v1/public/scores', {
      headers: {
        'x-forwarded-for': '1.2.3.5',
        'if-none-match': etag as string,
      },
    });

    const cachedResponse = await GET(cachedRequest);
    expect(cachedResponse.status).toBe(304);
  });
});
