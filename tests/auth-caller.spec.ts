import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateApiKey } from '@/lib/auth/api-keys';
import { resolveCaller } from '@/lib/auth/caller';
import { _setApiKeyStore, InMemoryApiKeyStore, type ApiKeyRecord } from '@/lib/auth/key-store';

const NOW = Date.UTC(2026, 0, 1);

let store: InMemoryApiKeyStore;

async function seed(overrides: Partial<ApiKeyRecord> = {}) {
  const generated = await generateApiKey();
  const record: ApiKeyRecord = {
    keyId: generated.keyId,
    displayPrefix: generated.displayPrefix,
    hash: generated.hash,
    name: 'agent',
    scopes: ['quotes:read', 'intents:write'],
    tier: 'partner',
    maxIntentAmount: '500',
    createdAt: new Date(NOW - 86_400_000).toISOString(),
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    ...overrides,
  };
  await store.create(record);
  return { key: generated.key, record };
}

beforeEach(() => {
  store = new InMemoryApiKeyStore();
  _setApiKeyStore(store);
});

afterEach(() => {
  _setApiKeyStore(null);
  vi.restoreAllMocks();
});

describe('resolveCaller', () => {
  it('resolves no credential to an anonymous caller keyed by IP', async () => {
    const result = await resolveCaller(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }));
    expect(result).toEqual({
      ok: true,
      caller: {
        kind: 'anonymous',
        id: 'anonymous',
        rateLimitKey: '203.0.113.7',
        keyId: null,
        tier: 'anonymous',
        scopes: ['quotes:read', 'intents:write', 'reputation:write'],
        maxIntentAmount: null,
      },
    });
  });

  it.each([
    ['Authorization: Bearer', (k: string) => ({ authorization: `Bearer ${k}` })],
    ['lowercase bearer', (k: string) => ({ authorization: `bearer ${k}` })],
    ['X-API-Key', (k: string) => ({ 'x-api-key': k })],
  ])('resolves a valid key via %s', async (_label, headers) => {
    const { key, record } = await seed();
    const result = await resolveCaller(new Headers(headers(key)), NOW);
    expect(result).toEqual({
      ok: true,
      caller: {
        kind: 'key',
        id: `key:${record.keyId}`,
        rateLimitKey: `key:${record.keyId}`,
        keyId: record.keyId,
        tier: 'partner',
        scopes: ['quotes:read', 'intents:write'],
        maxIntentAmount: '500',
      },
    });
  });

  it('rejects garbage, unknown keyIds and wrong secrets identically', async () => {
    const { key } = await seed();
    const garbage = await resolveCaller(new Headers({ authorization: 'Bearer nope' }), NOW);
    expect(garbage).toMatchObject({ ok: false, status: 401, code: 'invalid_api_key' });

    const unknown = await generateApiKey();
    const unknownResult = await resolveCaller(new Headers({ 'x-api-key': unknown.key }), NOW);
    const wrongSecret = key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A');
    const wrongResult = await resolveCaller(new Headers({ 'x-api-key': wrongSecret }), NOW);
    expect(unknownResult).toMatchObject({ ok: false, code: 'invalid_api_key' });
    expect(wrongResult).toEqual(unknownResult);
  });

  it('rejects revoked and expired keys', async () => {
    const revoked = await seed({ revokedAt: new Date(NOW - 1000).toISOString() });
    expect(await resolveCaller(new Headers({ 'x-api-key': revoked.key }), NOW)).toMatchObject({
      ok: false,
      code: 'revoked_api_key',
    });

    const expiring = await seed({ expiresAt: new Date(NOW).toISOString() });
    expect(await resolveCaller(new Headers({ 'x-api-key': expiring.key }), NOW - 1)).toMatchObject({
      ok: true,
    });
    expect(await resolveCaller(new Headers({ 'x-api-key': expiring.key }), NOW)).toMatchObject({
      ok: false,
      code: 'expired_api_key',
    });
  });

  it('touches the key once on success, and a failing touch does not fail resolution', async () => {
    const { key, record } = await seed();
    const touch = vi.spyOn(store, 'touch');
    await resolveCaller(new Headers({ 'x-api-key': key }), NOW);
    expect(touch).toHaveBeenCalledTimes(1);
    expect(touch).toHaveBeenCalledWith(record.keyId, new Date(NOW).toISOString());

    touch.mockRejectedValueOnce(new Error('db down'));
    expect(await resolveCaller(new Headers({ 'x-api-key': key }), NOW)).toMatchObject({
      ok: true,
    });
  });
});
