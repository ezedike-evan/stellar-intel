import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/v1/health/route';
import { withV1, type V1Context } from '@/lib/api/v1';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import { generateApiKey } from '@/lib/auth/api-keys';
import {
  _setApiKeyStore,
  InMemoryApiKeyStore,
  type ApiKeyRecord,
  type CallerTier,
} from '@/lib/auth/key-store';

let store: InMemoryApiKeyStore;

async function seedKey(tier: CallerTier = 'standard', overrides: Partial<ApiKeyRecord> = {}) {
  const generated = await generateApiKey();
  const record: ApiKeyRecord = {
    keyId: generated.keyId,
    displayPrefix: generated.displayPrefix,
    hash: generated.hash,
    name: 'test-client',
    scopes: ['quotes:read', 'intents:write'],
    tier,
    maxIntentAmount: '1000',
    createdAt: new Date().toISOString(),
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    ...overrides,
  };
  await store.create(record);
  return { rawKey: generated.key, keyId: generated.keyId, record };
}

beforeEach(() => {
  clearRateLimitStore();
  store = new InMemoryApiKeyStore();
  _setApiKeyStore(store);
  vi.stubEnv(
    'ANCHOR_PAYMENT_ACCOUNTS',
    JSON.stringify({ moneygram: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' })
  );
});

afterEach(() => {
  _setApiKeyStore(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('withV1 per-caller tiered rate limiting (#2200)', () => {
  it('anonymous GET /api/v1/health returns X-RateLimit-Limit: 60 and X-Caller-Tier: anonymous', async () => {
    const res = await GET(new NextRequest('http://localhost/api/v1/health'));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('60');
    expect(res.headers.get('X-Caller-Tier')).toBe('anonymous');
  });

  it('a standard key gets X-RateLimit-Limit: 300; a partner key gets 1200', async () => {
    const standard = await seedKey('standard');
    const partner = await seedKey('partner');

    const stdRes = await GET(
      new NextRequest('http://localhost/api/v1/health', {
        headers: { authorization: `Bearer ${standard.rawKey}` },
      })
    );
    expect(stdRes.status).toBe(200);
    expect(stdRes.headers.get('X-RateLimit-Limit')).toBe('300');
    expect(stdRes.headers.get('X-Caller-Tier')).toBe('standard');

    const partnerRes = await GET(
      new NextRequest('http://localhost/api/v1/health', {
        headers: { authorization: `Bearer ${partner.rawKey}` },
      })
    );
    expect(partnerRes.status).toBe(200);
    expect(partnerRes.headers.get('X-RateLimit-Limit')).toBe('1200');
    expect(partnerRes.headers.get('X-Caller-Tier')).toBe('partner');
  });

  it('two different keys from the same IP have independent counters, and independent from anonymous', async () => {
    const keyA = await seedKey('standard');
    const keyB = await seedKey('standard');
    const ip = '198.51.100.99';

    // 1 request from key A
    const resA1 = await GET(
      new NextRequest('http://localhost/api/v1/health', {
        headers: { authorization: `Bearer ${keyA.rawKey}`, 'x-forwarded-for': ip },
      })
    );
    expect(resA1.headers.get('X-RateLimit-Remaining')).toBe('299');

    // Key B from same IP should still have full limit (300 - 1 = 299)
    const resB1 = await GET(
      new NextRequest('http://localhost/api/v1/health', {
        headers: { authorization: `Bearer ${keyB.rawKey}`, 'x-forwarded-for': ip },
      })
    );
    expect(resB1.headers.get('X-RateLimit-Remaining')).toBe('299');

    // Anonymous from same IP should have 60 - 1 = 59
    const resAnon = await GET(
      new NextRequest('http://localhost/api/v1/health', {
        headers: { 'x-forwarded-for': ip },
      })
    );
    expect(resAnon.headers.get('X-RateLimit-Limit')).toBe('60');
    expect(resAnon.headers.get('X-RateLimit-Remaining')).toBe('59');
    expect(resAnon.headers.get('X-Caller-Tier')).toBe('anonymous');
  });

  it('an invalid key answers 401 invalid_api_key with WWW-Authenticate, handler spy not called, 31st attempt gives 429', async () => {
    const handlerSpy = vi.fn().mockResolvedValue({ status: 200, body: { ok: true } });
    const ip = '198.51.100.50';

    const makeInvalidReq = () =>
      new Request('http://localhost/api/v1/test', {
        headers: {
          authorization: 'Bearer invalid-api-key-guess',
          'x-forwarded-for': ip,
        },
      });

    // 1st attempt: 401 invalid_api_key
    const res1 = await withV1(
      makeInvalidReq(),
      { bucket: 'test.bucket', maxRequests: 10 },
      handlerSpy
    );
    expect(res1.status).toBe(401);
    expect(handlerSpy).not.toHaveBeenCalled();
    const body1 = await res1.json();
    expect(body1.error.code).toBe('invalid_api_key');
    expect(res1.headers.get('WWW-Authenticate')).toContain('Bearer');

    // 29 more attempts (total 30) -> all 401
    for (let i = 2; i <= 30; i++) {
      const res = await withV1(
        makeInvalidReq(),
        { bucket: 'test.bucket', maxRequests: 10 },
        handlerSpy
      );
      expect(res.status).toBe(401);
    }

    // 31st attempt -> 429 rate_limited
    const res31 = await withV1(
      makeInvalidReq(),
      { bucket: 'test.bucket', maxRequests: 10 },
      handlerSpy
    );
    expect(res31.status).toBe(429);
    const body31 = await res31.json();
    expect(body31.error.code).toBe('rate_limited');
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it('a revoked key answers 401 revoked_api_key', async () => {
    const revoked = await seedKey('standard', { revokedAt: new Date().toISOString() });
    const res = await GET(
      new NextRequest('http://localhost/api/v1/health', {
        headers: { authorization: `Bearer ${revoked.rawKey}` },
      })
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('revoked_api_key');
  });

  it('a handler passed to withV1 receives ctx.caller with kind: "key"', async () => {
    const key = await seedKey('standard');
    let capturedCtx: V1Context | null = null;

    const res = await withV1(
      new Request('http://localhost/api/v1/test', {
        headers: { authorization: `Bearer ${key.rawKey}` },
      }),
      { bucket: 'test.caller', maxRequests: 10 },
      async (ctx) => {
        capturedCtx = ctx;
        return { status: 200, body: { ok: true } };
      }
    );

    expect(res.status).toBe(200);
    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx!.caller.kind).toBe('key');
    expect(capturedCtx!.caller.keyId).toBe(key.keyId);
    expect(capturedCtx!.caller.tier).toBe('standard');
  });
});
