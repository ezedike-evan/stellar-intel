import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { API_VERSION, withRateLimitHeaders } from '@/lib/api/response';
import { rateLimitHeaders } from '@/lib/api/v1';
import type { RateLimitResult } from '@/lib/api/rate-limit';
import { clearIdempotencyStore } from '@/lib/api/idempotency';

// The two API stacks disagreed about what X-RateLimit-Reset means and kept
// separate idempotency stores, so a client's experience depended on which
// wrapper a route happened to use (#914).

function makeResult(overrides: Partial<RateLimitResult> = {}): RateLimitResult {
  return {
    allowed: true,
    remaining: 42,
    retryAfter: 0,
    limit: 60,
    resetAt: 1_800_000_000_000,
    shared: true,
    ...overrides,
  };
}

describe('X-RateLimit-Reset has one meaning (#914)', () => {
  it('both stacks emit the same epoch-seconds value', () => {
    const rl = makeResult();

    const viaResponse = withRateLimitHeaders(NextResponse.json({}), rl);
    const viaV1 = rateLimitHeaders(rl.limit, rl);

    const expected = String(Math.ceil(rl.resetAt / 1000));
    expect(viaResponse.headers.get('X-RateLimit-Reset')).toBe(expected);
    expect(viaV1['X-RateLimit-Reset']).toBe(expected);
  });

  it('reset is an absolute timestamp, not a delta', () => {
    // The v1 stack used to put retryAfter here — a small delta — which is
    // indistinguishable from an epoch only if you never look at it.
    const rl = makeResult({ allowed: false, remaining: 0, retryAfter: 30 });
    const headers = rateLimitHeaders(rl.limit, rl);

    expect(Number(headers['X-RateLimit-Reset'])).toBeGreaterThan(1_000_000_000);
    expect(headers['X-RateLimit-Reset']).not.toBe('30');
    // Retry-After is the header that carries the delta.
    expect(headers['Retry-After']).toBe('30');
  });

  it('v1 responses also carry API-Version', () => {
    expect(rateLimitHeaders(60, makeResult())['API-Version']).toBe(API_VERSION);
  });
});

describe('API-Version is stamped centrally (#914)', () => {
  it('is set on a response the handler did not stamp', async () => {
    const request = new NextRequest('https://example.test/api/anything');
    const response = await withRequestLogger(request, 'test', async () =>
      NextResponse.json({ ok: true })
    );
    expect(response.headers.get('API-Version')).toBe(API_VERSION);
  });

  it('is set even when the handler throws', async () => {
    const request = new NextRequest('https://example.test/api/anything');
    const response = await withRequestLogger(request, 'test', async () => {
      throw new Error('boom');
    });
    expect(response.status).toBe(500);
    expect(response.headers.get('API-Version')).toBe(API_VERSION);
  });

  it('does not overwrite a version the route set deliberately', async () => {
    const request = new NextRequest('https://example.test/api/anything');
    const response = await withRequestLogger(request, 'test', async () => {
      const r = NextResponse.json({ ok: true });
      r.headers.set('API-Version', '9.9.9');
      return r;
    });
    expect(response.headers.get('API-Version')).toBe('9.9.9');
  });
});

describe('one idempotency store (#914)', () => {
  beforeEach(() => {
    vi.resetModules();
    clearIdempotencyStore();
  });

  it('v1 replays a response stored through the shared module', async () => {
    const idempotency = await import('@/lib/api/idempotency');
    const v1 = await import('@/lib/api/v1');

    await idempotency.storeIdempotentResponse('shared-key', 201, { id: 'abc' });

    // Previously v1 kept its own Map, so this lookup missed and the request
    // re-executed.
    const replay = await v1.getIdempotentResponse('shared-key');
    expect(replay).not.toBeNull();
    expect(replay?.status).toBe(201);
    expect(replay?.headers.get('Idempotency-Replayed')).toBe('true');
    expect(await replay?.json()).toEqual({ id: 'abc' });
  });

  it('a response stored through v1 is visible to the shared module', async () => {
    const idempotency = await import('@/lib/api/idempotency');
    const v1 = await import('@/lib/api/v1');

    await v1.storeIdempotentResponse('v1-key', 200, { via: 'v1' });

    const stored = await idempotency.getIdempotentResponse('v1-key');
    expect(stored?.status).toBe(200);
    expect(stored?.body).toEqual({ via: 'v1' });
  });

  it('returns null for an unknown key', async () => {
    const v1 = await import('@/lib/api/v1');
    expect(await v1.getIdempotentResponse('never-stored')).toBeNull();
  });
});
