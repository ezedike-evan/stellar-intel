import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/v1/intent/offramp/route';
import { GET } from '@/app/api/v1/health/route';
import { rateLimitHeaders, clearIdempotencyStore } from '@/lib/api/v1';
import { API_VERSION } from '@/lib/api/response';
import { clearRateLimitStore } from '@/lib/api/rate-limit';

const VALID_INTENT = {
  type: 'offramp',
  sourceAsset: 'USDC',
  destinationAsset: 'NGN',
  amount: '100',
  sender: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  recipient: 'NGN-BANK-ACCOUNT-123',
};

function postV1(body: unknown, headers?: HeadersInit): NextRequest {
  return new NextRequest('http://localhost/api/v1/intent/offramp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  clearRateLimitStore();
  clearIdempotencyStore();
});

describe('rateLimitHeaders (#805)', () => {
  it('emits X-RateLimit-* headers, plus Retry-After only when throttled', () => {
    // X-RateLimit-Reset is epoch seconds, matching lib/api/response.ts. It was
    // seconds-until-reset here until #914, so the same header name meant two
    // different things depending on which route answered.
    expect(
      rateLimitHeaders(20, {
        allowed: true,
        remaining: 19,
        retryAfter: 0,
        limit: 20,
        resetAt: 1_800_000_000_000,
        shared: false,
      })
    ).toEqual({
      'API-Version': API_VERSION,
      'X-RateLimit-Limit': '20',
      'X-RateLimit-Remaining': '19',
      'X-RateLimit-Reset': '1800000000',
    });
    const throttled = rateLimitHeaders(20, {
      allowed: false,
      remaining: 0,
      retryAfter: 42,
      limit: 20,
      resetAt: 1_800_000_000_000,
      shared: false,
    });
    // Retry-After carries the delta; Reset stays absolute.
    expect(throttled['Retry-After']).toBe('42');
    expect(throttled['X-RateLimit-Reset']).toBe('1800000000');
  });
});

describe('POST /api/v1/intent/offramp (#805)', () => {
  it('returns 200 with the intent and rate-limit headers', async () => {
    const res = await POST(postV1(VALID_INTENT));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('20');
    expect(res.headers.get('X-RateLimit-Remaining')).not.toBeNull();
    expect(res.headers.get('X-Request-Id')).not.toBeNull();

    const data = (await res.json()) as { route: unknown; unsignedTx: string; quoteId: string };
    expect(data).toHaveProperty('route');
    expect(data.quoteId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses the standard error envelope for a validation error', async () => {
    const res = await POST(postV1({ ...VALID_INTENT, amount: 'not-a-number' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error?: { code: string; message: string; requestId: string };
    };
    expect(body.error?.code).toBe('validation_error');
    expect(typeof body.error?.message).toBe('string');
    expect(body.error?.requestId).toBe(res.headers.get('X-Request-Id'));
  });

  it('replays the original response for a repeated Idempotency-Key', async () => {
    const first = await POST(postV1(VALID_INTENT, { 'Idempotency-Key': 'key-1' }));
    const firstBody = await first.json();

    const second = await POST(postV1(VALID_INTENT, { 'Idempotency-Key': 'key-1' }));
    expect(second.headers.get('Idempotency-Replayed')).toBe('true');
    expect(await second.json()).toEqual(firstBody);
  });

  it('does not replay for a different Idempotency-Key', async () => {
    await POST(postV1(VALID_INTENT, { 'Idempotency-Key': 'key-1' }));
    const other = await POST(postV1(VALID_INTENT, { 'Idempotency-Key': 'key-2' }));
    expect(other.headers.get('Idempotency-Replayed')).toBeNull();
  });
});

describe('GET /api/v1/health (#805)', () => {
  it('reports ok on the versioned surface with rate-limit headers', async () => {
    const res = await GET(new NextRequest('http://localhost/api/v1/health'));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('60');
    const body = (await res.json()) as { status: string; version: string };
    expect(body.status).toBe('ok');
    expect(body.version).toBe('v1');
  });
});
