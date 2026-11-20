import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  getIdempotentResponse,
  storeIdempotentResponse,
  clearIdempotencyStore,
  scopedIdempotencyKey,
  IDEMPOTENCY_TTL_MS,
} from '@/lib/api/idempotency';
import { POST } from '@/app/api/intent/offramp/route';
import { POST as POST_V1 } from '@/app/api/v1/intent/offramp/route';
import { checkRateLimit, clearRateLimitStore } from '@/lib/api/rate-limit';

beforeEach(() => {
  clearIdempotencyStore();
  clearRateLimitStore();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('idempotency store', () => {
  it('returns null for a key that was never stored', async () => {
    expect(await getIdempotentResponse('unknown-key')).toBeNull();
  });

  it('returns the stored response for a known key', async () => {
    await storeIdempotentResponse('key-1', 200, { hello: 'world' }, { 'X-Test': '1' });
    const result = await getIdempotentResponse('key-1');
    expect(result).not.toBeNull();
    expect(result?.status).toBe(200);
    expect(result?.body).toEqual({ hello: 'world' });
    expect(result?.headers).toEqual({ 'X-Test': '1' });
  });

  it('expires an entry after IDEMPOTENCY_TTL_MS', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    await storeIdempotentResponse('key-2', 200, { a: 1 });
    expect(await getIdempotentResponse('key-2')).not.toBeNull();

    vi.setSystemTime(new Date(Date.now() + IDEMPOTENCY_TTL_MS + 1));
    expect(await getIdempotentResponse('key-2')).toBeNull();
  });

  it('does not expire an entry just under IDEMPOTENCY_TTL_MS', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    await storeIdempotentResponse('key-3', 200, { a: 1 });
    vi.setSystemTime(new Date(Date.now() + IDEMPOTENCY_TTL_MS - 1000));
    expect(await getIdempotentResponse('key-3')).not.toBeNull();
  });

  it('clearIdempotencyStore removes every entry', async () => {
    await storeIdempotentResponse('key-4', 200, { a: 1 });
    await storeIdempotentResponse('key-5', 400, { code: 'X' });
    clearIdempotencyStore();
    expect(await getIdempotentResponse('key-4')).toBeNull();
    expect(await getIdempotentResponse('key-5')).toBeNull();
  });
});

describe('POST /api/intent/offramp — idempotency and rate limiting (#1350)', () => {
  const INTENT = {
    type: 'offramp',
    sourceAsset: 'USDC',
    destinationAsset: 'NGN',
    amount: '100',
    sender: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    recipient: 'NGN-BANK-ACCOUNT-123',
  };

  function post(ip: string, key: string): NextRequest {
    return new NextRequest('http://localhost/api/intent/offramp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
        'x-forwarded-for': ip,
      },
      body: JSON.stringify(INTENT),
    });
  }

  beforeEach(() => {
    vi.stubEnv(
      'ANCHOR_PAYMENT_ACCOUNTS',
      JSON.stringify({ moneygram: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' })
    );
  });

  it('answers 429 instead of the cached body once the bucket is exhausted', async () => {
    const ip = '203.0.113.20';
    const first = await POST(post(ip, 'probe-key'));
    expect(first.status).toBe(200);

    for (let i = 0; i < 20; i += 1) {
      await checkRateLimit(ip, { bucket: 'api.intent.offramp', maxRequests: 20 });
    }

    const probe = await POST(post(ip, 'probe-key'));
    expect(probe.status).toBe(429);
    expect(probe.headers.get('Idempotency-Replayed')).toBeNull();
  });

  it('puts rate-limit headers on a replay within the limit', async () => {
    const ip = '203.0.113.21';
    await POST(post(ip, 'replay-key'));

    const replay = await POST(post(ip, 'replay-key'));
    expect(replay.status).toBe(200);
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true');
    expect(replay.headers.get('X-RateLimit-Remaining')).not.toBeNull();
  });
});

describe('scopedIdempotencyKey (#1351)', () => {
  it('is deterministic', async () => {
    expect(await scopedIdempotencyKey('s', 'k', 'b')).toBe(
      await scopedIdempotencyKey('s', 'k', 'b')
    );
  });

  it('changes with each of scope, key and body', async () => {
    const base = await scopedIdempotencyKey('s', 'k', 'b');
    expect(await scopedIdempotencyKey('s2', 'k', 'b')).not.toBe(base);
    expect(await scopedIdempotencyKey('s', 'k2', 'b')).not.toBe(base);
    expect(await scopedIdempotencyKey('s', 'k', 'b2')).not.toBe(base);
  });

  it('never contains the raw client key or body', async () => {
    const key = await scopedIdempotencyKey('s', 'my-secret-key', '{"recipient":"abc"}');
    expect(key).not.toContain('my-secret-key');
    expect(key).not.toContain('recipient');
    expect(key).toMatch(/^s:[0-9a-f]{64}:[0-9a-f]{64}$/);
  });
});

describe('idempotency key scoping on the intent routes (#1351)', () => {
  const SENDER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
  const INTENT = {
    type: 'offramp',
    sourceAsset: 'USDC',
    destinationAsset: 'NGN',
    amount: '100',
    sender: SENDER,
    recipient: 'NGN-BANK-ACCOUNT-123',
  };

  function request(path: string, body: unknown, key: string): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
        'x-forwarded-for': '203.0.113.30',
      },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    vi.stubEnv('ANCHOR_PAYMENT_ACCOUNTS', JSON.stringify({ moneygram: SENDER }));
  });

  it('replays the same key with the same body', async () => {
    await POST(request('/api/intent/offramp', INTENT, 'same'));
    const replay = await POST(request('/api/intent/offramp', INTENT, 'same'));
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true');
  });

  it('does not replay the same key with a different body', async () => {
    const first = await POST(request('/api/intent/offramp', INTENT, 'shared-key'));
    const second = await POST(
      request('/api/intent/offramp', { ...INTENT, recipient: 'NGN-OTHER-ACCOUNT-9' }, 'shared-key')
    );

    expect(second.status).toBe(200);
    expect(second.headers.get('Idempotency-Replayed')).toBeNull();
    const a = (await first.json()) as { quoteId: string };
    const b = (await second.json()) as { quoteId: string };
    expect(b.quoteId).not.toBe(a.quoteId);
  });

  it('does not replay across the internal and v1 routes', async () => {
    await POST(request('/api/intent/offramp', INTENT, 'cross-route'));
    const v1 = await POST_V1(request('/api/v1/intent/offramp', INTENT, 'cross-route'));

    expect(v1.status).toBe(200);
    expect(v1.headers.get('Idempotency-Replayed')).toBeNull();
  });

  it('still replays on the v1 route for the same key and body', async () => {
    await POST_V1(request('/api/v1/intent/offramp', INTENT, 'v1-same'));
    const replay = await POST_V1(request('/api/v1/intent/offramp', INTENT, 'v1-same'));
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true');
  });
});
