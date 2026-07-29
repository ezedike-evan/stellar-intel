import { describe, it, expect } from 'vitest';
import {
  API_VERSION,
  apiErrorResponse,
  apiSuccessResponse,
  rateLimitedResponse,
  withApiHeaders,
  withRateLimitHeaders,
} from '@/lib/api/response';
import { NextResponse } from 'next/server';
import type { RateLimitResult } from '@/lib/api/rate-limit';

const RL: RateLimitResult = {
  allowed: true,
  remaining: 5,
  retryAfter: 0,
  limit: 20,
  resetAt: Date.parse('2026-01-01T00:01:00Z'),
};

describe('withApiHeaders', () => {
  it('stamps API-Version on the response', () => {
    const res = withApiHeaders(NextResponse.json({}));
    expect(res.headers.get('API-Version')).toBe(API_VERSION);
  });
});

describe('withRateLimitHeaders', () => {
  it('stamps limit, remaining, and reset', () => {
    const res = withRateLimitHeaders(NextResponse.json({}), RL);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('20');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('5');
    expect(res.headers.get('X-RateLimit-Reset')).toBe(String(Math.ceil(RL.resetAt / 1000)));
  });
});

describe('rateLimitedResponse', () => {
  it('returns a 429 with the ApiError envelope, Retry-After, and rate-limit headers', async () => {
    const rl: RateLimitResult = { ...RL, allowed: false, remaining: 0, retryAfter: 42 };
    const res = rateLimitedResponse(rl);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(res.headers.get('API-Version')).toBe(API_VERSION);

    const body = await res.json();
    expect(body).toEqual({ code: 'RATE_LIMITED', message: 'Too many requests', retryAfter: 42 });
  });
});

describe('apiErrorResponse', () => {
  it('returns the given status and body, stamped with API-Version', async () => {
    const res = apiErrorResponse({ code: 'NO_ROUTE', message: 'no route' }, 400);
    expect(res.status).toBe(400);
    expect(res.headers.get('API-Version')).toBe(API_VERSION);
    expect(await res.json()).toEqual({ code: 'NO_ROUTE', message: 'no route' });
  });
});

describe('apiSuccessResponse', () => {
  it('returns 200 by default, stamped with API-Version', async () => {
    const res = apiSuccessResponse({ ok: true });
    expect(res.status).toBe(200);
    expect(res.headers.get('API-Version')).toBe(API_VERSION);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('honors a custom status', () => {
    const res = apiSuccessResponse({ ok: true }, { status: 201 });
    expect(res.status).toBe(201);
  });
});
