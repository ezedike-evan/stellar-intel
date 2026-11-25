import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateApiKey } from '@/lib/auth/api-keys';
import { InMemoryApiKeyStore, _setApiKeyStore, type ApiKeyRecord } from '@/lib/auth/key-store';
import { anonymousScopes, resolveCaller } from '@/lib/auth/caller';

describe('lib/auth/caller.ts (AGS003)', () => {
  let store: InMemoryApiKeyStore;

  beforeEach(() => {
    store = new InMemoryApiKeyStore();
    _setApiKeyStore(store);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('anonymous caller with no header returns anonymous identity and rate limit key', async () => {
    const headers = new Headers({ 'x-forwarded-for': '198.51.100.42' });
    const resolution = await resolveCaller(headers);

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;

    expect(resolution.caller).toMatchObject({
      kind: 'anonymous',
      id: 'anonymous',
      rateLimitKey: '198.51.100.42',
      keyId: null,
      tier: 'anonymous',
      scopes: anonymousScopes(),
      maxIntentAmount: null,
    });
    expect(resolution.caller.id).not.toContain('198.51.100.42');
  });

  it('Authorization: Bearer <key>, lowercase bearer, and X-API-Key resolve keyed caller', async () => {
    const key = await generateApiKey();
    const record: ApiKeyRecord = {
      keyId: key.keyId,
      displayPrefix: key.displayPrefix,
      hash: key.hash,
      name: 'Agent Key',
      scopes: ['quotes:read', 'intents:write'],
      tier: 'partner',
      maxIntentAmount: '5000',
      createdAt: new Date().toISOString(),
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    };
    await store.create(record);

    // Standard Bearer
    const res1 = await resolveCaller(new Headers({ authorization: `Bearer ${key.key}` }));
    expect(res1.ok).toBe(true);
    if (!res1.ok) return;
    expect(res1.caller).toMatchObject({
      kind: 'key',
      id: `key:${key.keyId}`,
      rateLimitKey: `key:${key.keyId}`,
      keyId: key.keyId,
      tier: 'partner',
      scopes: ['quotes:read', 'intents:write'],
      maxIntentAmount: '5000',
    });

    // Lowercase bearer
    const res2 = await resolveCaller(new Headers({ authorization: `bearer ${key.key}` }));
    expect(res2.ok).toBe(true);

    // X-API-Key
    const res3 = await resolveCaller(new Headers({ 'x-api-key': key.key }));
    expect(res3.ok).toBe(true);
  });

  it('garbage credential returns invalid_api_key without falling back to anonymous', async () => {
    const res = await resolveCaller(new Headers({ authorization: 'Bearer totally-invalid-key' }));
    expect(res).toEqual({
      ok: false,
      status: 401,
      code: 'invalid_api_key',
      message: 'API key is not valid',
    });
  });

  it('unknown keyId or wrong secret gives invalid_api_key with identical message', async () => {
    const key = await generateApiKey();
    // Not saved in store
    const resUnknown = await resolveCaller(new Headers({ authorization: `Bearer ${key.key}` }));
    expect(resUnknown).toEqual({
      ok: false,
      status: 401,
      code: 'invalid_api_key',
      message: 'API key is not valid',
    });

    // Saved in store, but wrong secret presented
    await store.create({
      keyId: key.keyId,
      displayPrefix: key.displayPrefix,
      hash: '0'.repeat(64),
      name: 'Key',
      scopes: ['quotes:read'],
      tier: 'standard',
      maxIntentAmount: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    });
    const resWrongSecret = await resolveCaller(new Headers({ authorization: `Bearer ${key.key}` }));
    expect(resWrongSecret).toEqual({
      ok: false,
      status: 401,
      code: 'invalid_api_key',
      message: 'API key is not valid',
    });
  });

  it('revoked key returns revoked_api_key and expired key returns expired_api_key', async () => {
    const key1 = await generateApiKey();
    await store.create({
      keyId: key1.keyId,
      displayPrefix: key1.displayPrefix,
      hash: key1.hash,
      name: 'Revoked Key',
      scopes: ['quotes:read'],
      tier: 'standard',
      maxIntentAmount: null,
      createdAt: '2026-11-21T10:00:00.000Z',
      expiresAt: null,
      revokedAt: '2026-11-21T11:00:00.000Z',
      lastUsedAt: null,
    });
    expect(await resolveCaller(new Headers({ authorization: `Bearer ${key1.key}` }))).toEqual({
      ok: false,
      status: 401,
      code: 'revoked_api_key',
      message: 'API key has been revoked',
    });

    const key2 = await generateApiKey();
    await store.create({
      keyId: key2.keyId,
      displayPrefix: key2.displayPrefix,
      hash: key2.hash,
      name: 'Expired Key',
      scopes: ['quotes:read'],
      tier: 'standard',
      maxIntentAmount: null,
      createdAt: '2026-11-21T10:00:00.000Z',
      expiresAt: '2026-11-21T11:00:00.000Z',
      revokedAt: null,
      lastUsedAt: null,
    });
    const nowAfterExp = Date.parse('2026-11-21T11:00:01.000Z');
    expect(
      await resolveCaller(new Headers({ authorization: `Bearer ${key2.key}` }), nowAfterExp)
    ).toEqual({
      ok: false,
      status: 401,
      code: 'expired_api_key',
      message: 'API key has expired',
    });
  });

  it('touch is called on success, and a rejecting touch does not fail resolution', async () => {
    const key = await generateApiKey();
    await store.create({
      keyId: key.keyId,
      displayPrefix: key.displayPrefix,
      hash: key.hash,
      name: 'Key',
      scopes: ['quotes:read'],
      tier: 'standard',
      maxIntentAmount: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    });

    vi.spyOn(store, 'touch').mockRejectedValueOnce(new Error('db connection failed'));
    const res = await resolveCaller(new Headers({ authorization: `Bearer ${key.key}` }));
    expect(res.ok).toBe(true);
    expect(store.touch).toHaveBeenCalledTimes(1);
  });
});
