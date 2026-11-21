import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/v1/auth/token/route';
import { GET as health } from '@/app/api/v1/health/route';
import { generateApiKey, type ApiScope } from '@/lib/auth/api-keys';
import { _setApiKeyStore, InMemoryApiKeyStore, type ApiKeyRecord } from '@/lib/auth/key-store';
import { signCallerToken, verifyCallerToken } from '@/lib/auth/token';
import { clearRateLimitStore } from '@/lib/api/rate-limit';

const SECRET = 'x'.repeat(32);

let store: InMemoryApiKeyStore;

async function seed(overrides: Partial<ApiKeyRecord> = {}) {
  const generated = await generateApiKey();
  const record: ApiKeyRecord = {
    keyId: generated.keyId,
    displayPrefix: generated.displayPrefix,
    hash: generated.hash,
    name: 'integrator',
    scopes: ['quotes:read', 'intents:write'],
    tier: 'partner',
    maxIntentAmount: null,
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    ...overrides,
  };
  await store.create(record);
  return { key: generated.key, record };
}

function exchange(body?: unknown, credential?: string): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (credential) headers['Authorization'] = `Bearer ${credential}`;
  return new NextRequest('http://localhost/api/v1/auth/token', {
    method: 'POST',
    headers,
    body: body === undefined ? null : JSON.stringify(body),
  });
}

interface TokenBody {
  token: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: string;
  scopes: ApiScope[];
  tier: string;
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

beforeEach(() => {
  clearRateLimitStore();
  vi.stubEnv('CALLER_TOKEN_SECRET', SECRET);
  store = new InMemoryApiKeyStore();
  _setApiKeyStore(store);
});

afterEach(() => {
  _setApiKeyStore(null);
  vi.unstubAllEnvs();
});

describe('POST /api/v1/auth/token', () => {
  it('rejects an anonymous call with 401 api_key_required', async () => {
    const res = await POST(exchange({}));
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe('api_key_required');
  });

  it('rejects a token as the credential with 401 api_key_required', async () => {
    const { record } = await seed();
    const token = await signCallerToken(
      { keyId: record.keyId, scopes: ['quotes:read'], ttlSeconds: 600 },
      SECRET
    );
    const res = await POST(exchange({}, token));
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe('api_key_required');
  });

  it('exchanges a key for a token verifyCallerToken accepts, with no-store', async () => {
    const { key, record } = await seed();
    const res = await POST(exchange(undefined, key));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    const body = (await res.json()) as TokenBody;
    expect(body.tokenType).toBe('Bearer');
    expect(body.expiresIn).toBe(900);
    expect(body.scopes).toEqual(['quotes:read', 'intents:write']);
    expect(body.tier).toBe('partner');
    expect(Date.parse(body.expiresAt) - Date.now()).toBeLessThanOrEqual(900_000);

    const verification = await verifyCallerToken(body.token, SECRET);
    expect(verification.ok).toBe(true);
    if (!verification.ok) return;
    expect(verification.claims.sub).toBe(record.keyId);
    expect(verification.claims.scp).toEqual(['quotes:read', 'intents:write']);
    expect(verification.claims.exp - verification.claims.iat).toBe(900);
    expect(new Date(verification.claims.exp * 1000).toISOString()).toBe(body.expiresAt);
  });

  it('honours a scope subset and a custom ttl', async () => {
    const { key } = await seed();
    const res = await POST(exchange({ scopes: ['quotes:read'], ttlSeconds: 120 }, key));
    expect(res.status).toBe(200);
    const body = (await res.json()) as TokenBody;
    expect(body.scopes).toEqual(['quotes:read']);
    expect(body.expiresIn).toBe(120);

    const verification = await verifyCallerToken(body.token, SECRET);
    expect(verification.ok && verification.claims.scp).toEqual(['quotes:read']);
  });

  it('rejects a scope superset with 403 insufficient_scope', async () => {
    const { key } = await seed({ scopes: ['quotes:read'] });
    const res = await POST(exchange({ scopes: ['quotes:read', 'intents:write'] }, key));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('insufficient_scope');
  });

  it.each([30, 901, 60.5])('rejects ttlSeconds %s with 400', async (ttlSeconds) => {
    const { key } = await seed();
    const res = await POST(exchange({ ttlSeconds }, key));
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('validation_error');
  });

  it.each([[[]], [['quotes:read', 'quotes:read']], [['nope']]])(
    'rejects scopes %j with 400',
    async (scopes) => {
      const { key } = await seed();
      const res = await POST(exchange({ scopes }, key));
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe('validation_error');
    }
  );

  it('answers 503 tokens_unavailable when the secret is unset', async () => {
    const { key } = await seed();
    vi.stubEnv('CALLER_TOKEN_SECRET', '');
    const res = await POST(exchange({}, key));
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe('tokens_unavailable');
  });

  it('issues a token that works on GET /api/v1/health at the key tier', async () => {
    const { key } = await seed({ tier: 'standard' });
    const res = await POST(exchange({ scopes: ['quotes:read'] }, key));
    const { token } = (await res.json()) as TokenBody;

    const probe = await health(
      new NextRequest('http://localhost/api/v1/health', {
        headers: { Authorization: `Bearer ${token}` },
      })
    );
    expect(probe.status).toBe(200);
    expect(probe.headers.get('X-Caller-Tier')).toBe('standard');
  });
});
