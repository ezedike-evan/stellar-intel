import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/admin/keys/route';
import { DELETE } from '@/app/api/admin/keys/[keyId]/route';
import { API_KEY_PATTERN, generateApiKey, hashApiKey, type ApiScope } from '@/lib/auth/api-keys';
import { InMemoryApiKeyStore, _setApiKeyStore } from '@/lib/auth/key-store';
import { clearRateLimitStore } from '@/lib/api/rate-limit';

const ADMIN_KEY = 'test-admin-secret';

let store: InMemoryApiKeyStore;

beforeEach(() => {
  process.env.ADMIN_SECRET_KEY = ADMIN_KEY;
  store = new InMemoryApiKeyStore();
  _setApiKeyStore(store);
  clearRateLimitStore();
});

afterEach(() => {
  delete process.env.ADMIN_SECRET_KEY;
  _setApiKeyStore(null);
});

function post(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/admin/keys', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-key': ADMIN_KEY,
      'x-forwarded-for': '203.0.113.70',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function get(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/admin/keys', {
    method: 'GET',
    headers: { 'x-admin-key': ADMIN_KEY, 'x-forwarded-for': '203.0.113.70', ...headers },
  });
}

function del(keyId: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/admin/keys/${keyId}`, {
    method: 'DELETE',
    headers: { 'x-admin-key': ADMIN_KEY, 'x-forwarded-for': '203.0.113.70', ...headers },
  });
}

const params = (keyId: string) => ({ params: Promise.resolve({ keyId }) });

const validBody = { name: 'Partner agent', scopes: ['quotes:read'] };

async function createKey(body: unknown = validBody) {
  const res = await POST(post(body));
  expect(res.status).toBe(201);
  return (await res.json()) as {
    key: string;
    keyId: string;
    displayPrefix: string;
    name: string;
    scopes: ApiScope[];
    tier: string;
    maxIntentAmount: string | null;
    createdAt: string;
    expiresAt: string | null;
  };
}

describe('admin caller-key routes — authentication', () => {
  it('answers 403 without an admin key', async () => {
    const res = await POST(post(validBody, { 'x-admin-key': '' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('answers 403 to a caller key with the admin scope sent as a bearer token', async () => {
    const caller = await generateApiKey();
    await store.create({
      keyId: caller.keyId,
      displayPrefix: caller.displayPrefix,
      hash: caller.hash,
      name: 'admin-scoped caller',
      scopes: ['admin'],
      tier: 'partner',
      maxIntentAmount: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    });

    const res = await POST(
      post(validBody, { 'x-admin-key': '', Authorization: `Bearer ${caller.key}` })
    );
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/keys', () => {
  it('issues a key, stores only its hash, and disables caching', async () => {
    const res = await POST(post(validBody));
    expect(res.status).toBe(201);
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    const body = (await res.json()) as { key: string; keyId: string; displayPrefix: string };
    expect(body.key).toMatch(API_KEY_PATTERN);
    expect(body.displayPrefix).toBe(`sik_${body.keyId}`);

    const stored = await store.get(body.keyId);
    expect(stored).not.toBeNull();
    expect(stored?.hash).toBe(await hashApiKey(body.key));
    expect(stored).not.toHaveProperty('key');
    expect(stored?.revokedAt).toBeNull();
    expect(stored?.lastUsedAt).toBeNull();
  });
});

describe('GET /api/admin/keys', () => {
  it('lists keys without hash or raw key', async () => {
    await createKey({ name: 'first', scopes: ['quotes:read'] });
    await createKey({ name: 'second', scopes: ['intents:write'], tier: 'partner' });

    const res = await GET(get());
    expect(res.status).toBe(200);

    const list = (await res.json()) as Record<string, unknown>[];
    expect(list).toHaveLength(2);
    for (const item of list) {
      expect(item).not.toHaveProperty('hash');
      expect(item).not.toHaveProperty('key');
      expect(item).toHaveProperty('displayPrefix');
    }
  });
});

describe('POST /api/admin/keys — validation', () => {
  it('rejects an unknown scope', async () => {
    const res = await POST(post({ name: 'x', scopes: ['quotes:write'] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects duplicate scopes', async () => {
    const res = await POST(post({ name: 'x', scopes: ['quotes:read', 'quotes:read'] }));
    expect(res.status).toBe(400);
  });

  it('rejects expiresInDays: 0', async () => {
    const res = await POST(post({ name: 'x', scopes: ['quotes:read'], expiresInDays: 0 }));
    expect(res.status).toBe(400);
  });

  it('rejects a negative maxIntentAmount', async () => {
    const res = await POST(post({ name: 'x', scopes: ['quotes:read'], maxIntentAmount: '-5' }));
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/admin/keys/[keyId]', () => {
  it('revokes once with 204, then answers 404', async () => {
    const created = await createKey();

    const first = await DELETE(del(created.keyId), params(created.keyId));
    expect(first.status).toBe(204);

    const second = await DELETE(del(created.keyId), params(created.keyId));
    expect(second.status).toBe(404);
    expect(await second.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a malformed keyId with 400', async () => {
    const res = await DELETE(del('not-a-key'), params('not-a-key'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
