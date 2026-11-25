import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateApiKey, type ApiScope } from '@/lib/auth/api-keys';
import { resolveCaller } from '@/lib/auth/caller';
import { _setApiKeyStore, InMemoryApiKeyStore, type ApiKeyRecord } from '@/lib/auth/key-store';
import { signCallerToken } from '@/lib/auth/token';

const SECRET = 'x'.repeat(32);
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
    maxIntentAmount: '250',
    createdAt: new Date(NOW - 86_400_000).toISOString(),
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    ...overrides,
  };
  await store.create(record);
  return { key: generated.key, record };
}

function mint(keyId: string, scopes: ApiScope[], secret = SECRET, ttlSeconds = 600) {
  return signCallerToken({ keyId, scopes, ttlSeconds }, secret, NOW);
}

function bearer(token: string): Headers {
  return new Headers({ authorization: `Bearer ${token}` });
}

beforeEach(() => {
  vi.stubEnv('CALLER_TOKEN_SECRET', SECRET);
  store = new InMemoryApiKeyStore();
  _setApiKeyStore(store);
});

afterEach(() => {
  _setApiKeyStore(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('resolveCaller with caller tokens', () => {
  it('resolves a valid token as kind token sharing the key rateLimitKey', async () => {
    const { key, record } = await seed();
    const touch = vi.spyOn(store, 'touch');
    const token = await mint(record.keyId, ['quotes:read']);

    const viaToken = await resolveCaller(bearer(token), NOW);
    expect(viaToken).toEqual({
      ok: true,
      caller: {
        kind: 'token',
        id: `key:${record.keyId}`,
        rateLimitKey: `key:${record.keyId}`,
        keyId: record.keyId,
        tier: 'partner',
        scopes: ['quotes:read'],
        maxIntentAmount: '250',
      },
    });
    expect(touch).not.toHaveBeenCalled();

    const viaKey = await resolveCaller(bearer(key), NOW);
    expect(viaKey.ok && viaKey.caller.rateLimitKey).toBe(
      viaToken.ok && viaToken.caller.rateLimitKey
    );
  });

  it('intersects token scopes with the key scopes narrowed after minting', async () => {
    const { record } = await seed();
    const token = await mint(record.keyId, ['quotes:read', 'intents:write']);

    // Narrow the key after the token was minted.
    const narrowed = new InMemoryApiKeyStore();
    await narrowed.create({ ...record, scopes: ['quotes:read'] });
    _setApiKeyStore(narrowed);

    const result = await resolveCaller(bearer(token), NOW);
    expect(result.ok && result.caller.scopes).toEqual(['quotes:read']);
  });

  it('takes the tier from the key record, never the token', async () => {
    const { record } = await seed({ tier: 'standard' });
    const result = await resolveCaller(bearer(await mint(record.keyId, ['quotes:read'])), NOW);
    expect(result.ok && result.caller.tier).toBe('standard');
  });

  it('gives revoked_api_key once the key is revoked, immediately', async () => {
    const { record } = await seed();
    const token = await mint(record.keyId, ['quotes:read']);
    expect(await resolveCaller(bearer(token), NOW)).toMatchObject({ ok: true });

    await store.revoke(record.keyId, new Date(NOW).toISOString());
    expect(await resolveCaller(bearer(token), NOW + 1000)).toEqual({
      ok: false,
      status: 401,
      code: 'revoked_api_key',
      message: expect.any(String),
    });
  });

  it('gives revoked_api_key for a missing or expired key', async () => {
    const missing = await mint('fedcba9876543210', ['quotes:read']);
    expect(await resolveCaller(bearer(missing), NOW)).toMatchObject({
      ok: false,
      code: 'revoked_api_key',
    });

    const { record } = await seed({ expiresAt: new Date(NOW).toISOString() });
    const token = await mint(record.keyId, ['quotes:read']);
    expect(await resolveCaller(bearer(token), NOW)).toMatchObject({
      ok: false,
      code: 'revoked_api_key',
    });
  });

  it('gives token_expired for an expired token', async () => {
    const { record } = await seed();
    const token = await mint(record.keyId, ['quotes:read'], SECRET, 60);
    expect(await resolveCaller(bearer(token), NOW + 60_000)).toMatchObject({
      ok: false,
      status: 401,
      code: 'token_expired',
    });
  });

  it('fails closed with invalid_token when the secret is unset', async () => {
    const { record } = await seed();
    const token = await mint(record.keyId, ['quotes:read']);
    vi.stubEnv('CALLER_TOKEN_SECRET', '');
    expect(await resolveCaller(bearer(token), NOW)).toEqual({
      ok: false,
      status: 401,
      code: 'invalid_token',
      message: 'Caller tokens are not enabled on this deployment',
    });
  });

  it('gives invalid_token for a token signed with another secret', async () => {
    const { record } = await seed();
    const token = await mint(record.keyId, ['quotes:read'], 'y'.repeat(32));
    expect(await resolveCaller(bearer(token), NOW)).toMatchObject({
      ok: false,
      status: 401,
      code: 'invalid_token',
    });
  });

  it('gives invalid_token for a malformed token', async () => {
    expect(await resolveCaller(bearer('a.b.c'), NOW)).toMatchObject({
      ok: false,
      code: 'invalid_token',
    });
  });

  it('still resolves sik_ keys as kind key', async () => {
    const { key } = await seed();
    const result = await resolveCaller(new Headers({ 'x-api-key': key }), NOW);
    expect(result).toMatchObject({ ok: true, caller: { kind: 'key' } });
  });
});
