import { afterEach, describe, expect, it } from 'vitest';
import {
  _setApiKeyStore,
  getApiKeyStore,
  InMemoryApiKeyStore,
  type ApiKeyRecord,
} from '@/lib/auth/key-store';

function record(keyId: string, createdAt: string): ApiKeyRecord {
  return {
    keyId,
    displayPrefix: `sik_${keyId}`,
    hash: 'f'.repeat(64),
    name: 'test key',
    scopes: ['quotes:read'],
    tier: 'standard',
    maxIntentAmount: null,
    createdAt,
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
  };
}

const A = '0000000000000001';
const B = '0000000000000002';

afterEach(() => _setApiKeyStore(null));

describe('InMemoryApiKeyStore', () => {
  it('round-trips create/get and returns copies', async () => {
    const store = new InMemoryApiKeyStore();
    await store.create(record(A, '2026-01-01T00:00:00.000Z'));
    const got = await store.get(A);
    expect(got).toEqual(record(A, '2026-01-01T00:00:00.000Z'));
    got!.name = 'mutated';
    got!.scopes.push('admin');
    expect((await store.get(A))?.name).toBe('test key');
    expect((await store.get(A))?.scopes).toEqual(['quotes:read']);
    expect(await store.get(B)).toBeNull();
  });

  it('throws on a duplicate create', async () => {
    const store = new InMemoryApiKeyStore();
    await store.create(record(A, '2026-01-01T00:00:00.000Z'));
    await expect(store.create(record(A, '2026-01-02T00:00:00.000Z'))).rejects.toThrow(
      'api key already exists'
    );
  });

  it('lists newest first', async () => {
    const store = new InMemoryApiKeyStore();
    await store.create(record(A, '2026-01-01T00:00:00.000Z'));
    await store.create(record(B, '2026-01-02T00:00:00.000Z'));
    expect((await store.list()).map((r) => r.keyId)).toEqual([B, A]);
  });

  it('revokes once', async () => {
    const store = new InMemoryApiKeyStore();
    await store.create(record(A, '2026-01-01T00:00:00.000Z'));
    expect(await store.revoke(A, '2026-02-01T00:00:00.000Z')).toBe(true);
    expect(await store.revoke(A, '2026-02-02T00:00:00.000Z')).toBe(false);
    expect(await store.revoke(B, '2026-02-01T00:00:00.000Z')).toBe(false);
    expect((await store.get(A))?.revokedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('touch sets lastUsedAt', async () => {
    const store = new InMemoryApiKeyStore();
    await store.create(record(A, '2026-01-01T00:00:00.000Z'));
    await store.touch(A, '2026-03-01T00:00:00.000Z');
    await store.touch(B, '2026-03-01T00:00:00.000Z');
    expect((await store.get(A))?.lastUsedAt).toBe('2026-03-01T00:00:00.000Z');
  });
});

describe('getApiKeyStore', () => {
  it('returns the in-memory store when DATABASE_URL is empty', () => {
    expect(getApiKeyStore()).toBeInstanceOf(InMemoryApiKeyStore);
  });
});
