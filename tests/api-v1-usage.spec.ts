import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as healthGet } from '@/app/api/v1/health/route';
import { GET as usageGet } from '@/app/api/v1/usage/route';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import { InMemoryApiKeyStore, _setApiKeyStore, type ApiKeyRecord } from '@/lib/auth/key-store';
import { generateApiKey } from '@/lib/auth/api-keys';
import { signCallerToken } from '@/lib/auth/token';

const SECRET = 'x'.repeat(32);

async function seedKey(
  store: InMemoryApiKeyStore,
  overrides: Partial<ApiKeyRecord> = {}
): Promise<{ key: string; record: ApiKeyRecord }> {
  const generated = await generateApiKey();
  const record: ApiKeyRecord = {
    keyId: generated.keyId,
    displayPrefix: generated.displayPrefix,
    hash: generated.hash,
    name: 'test key',
    scopes: ['quotes:read'],
    tier: 'standard',
    maxIntentAmount: null,
    createdAt: '2026-11-22T10:00:00.000Z',
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    ...overrides,
  };
  await store.create(record);
  return { key: generated.key, record };
}

function request(url: string, key?: string, ip = '1.2.3.4'): NextRequest {
  return new NextRequest(url, {
    headers: {
      'x-forwarded-for': ip,
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
  });
}

interface UsageBody {
  caller: { kind: string; keyPrefix: string | null; tier: string; scopes: string[] };
  quota: { limit: number; used: number; resetAt: string } | null;
  windows: Array<{ bucket: string; used: number; resetAt: string }>;
}

describe('GET /api/v1/usage (AGS025, #2218)', () => {
  let store: InMemoryApiKeyStore;

  beforeEach(() => {
    clearRateLimitStore();
    store = new InMemoryApiKeyStore();
    _setApiKeyStore(store);
  });

  afterEach(() => {
    _setApiKeyStore(null);
    vi.unstubAllEnvs();
  });

  it('anonymous: kind anonymous, keyPrefix null, quota null, and no IP in the body', async () => {
    const res = await usageGet(request('http://localhost/api/v1/usage', undefined, '203.0.113.7'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as UsageBody;
    expect(body.caller.kind).toBe('anonymous');
    expect(body.caller.keyPrefix).toBeNull();
    expect(body.quota).toBeNull();
    expect(JSON.stringify(body)).not.toContain('203.0.113.7');
  });

  it('a keyed caller after 3 health calls has a v1.health window with used 3', async () => {
    const { key, record } = await seedKey(store);
    await healthGet(request('http://localhost/api/v1/health', key));
    await healthGet(request('http://localhost/api/v1/health', key));
    await healthGet(request('http://localhost/api/v1/health', key));

    const res = await usageGet(request('http://localhost/api/v1/usage', key));
    expect(res.status).toBe(200);
    const body = (await res.json()) as UsageBody;
    expect(body.caller).toEqual({
      kind: 'key',
      keyPrefix: `sik_${record.keyId}`,
      tier: 'standard',
      scopes: ['quotes:read'],
    });
    expect(body.quota?.limit).toBe(50_000);
    const health = body.windows.find((w) => w.bucket === 'v1.health');
    expect(health?.used).toBe(3);
    expect(typeof health?.resetAt).toBe('string');
  });

  it('calling usage twice does not change the v1.health count', async () => {
    const { key } = await seedKey(store);
    await healthGet(request('http://localhost/api/v1/health', key));
    await healthGet(request('http://localhost/api/v1/health', key));
    await healthGet(request('http://localhost/api/v1/health', key));

    const first = (await (
      await usageGet(request('http://localhost/api/v1/usage', key))
    ).json()) as UsageBody;
    const second = (await (
      await usageGet(request('http://localhost/api/v1/usage', key))
    ).json()) as UsageBody;
    expect(first.windows.find((w) => w.bucket === 'v1.health')?.used).toBe(3);
    expect(second.windows.find((w) => w.bucket === 'v1.health')?.used).toBe(3);
  });

  it('a token caller shows the minting key prefix', async () => {
    vi.stubEnv('CALLER_TOKEN_SECRET', SECRET);
    const { record } = await seedKey(store);
    const token = await signCallerToken(
      { keyId: record.keyId, scopes: ['quotes:read'], ttlSeconds: 300 },
      SECRET
    );

    const res = await usageGet(request('http://localhost/api/v1/usage', token));
    expect(res.status).toBe(200);
    const body = (await res.json()) as UsageBody;
    expect(body.caller.kind).toBe('token');
    expect(body.caller.keyPrefix).toBe(`sik_${record.keyId}`);
  });
});
