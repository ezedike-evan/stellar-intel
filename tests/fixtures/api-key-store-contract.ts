import { expect, it } from 'vitest';
import type { ApiKeyRecord, ApiKeyStore } from '@/lib/auth/key-store';

/**
 * The `ApiKeyStore` contract (AGS002), run against every implementation so the
 * in-memory store used in dev and tests cannot drift from the Postgres store used
 * in production. Call it inside a `describe` with a factory that returns a fresh,
 * empty store for each test.
 */
export function apiKeyStoreContract(makeStore: () => Promise<ApiKeyStore>): void {
  it('get returns the record as created, and null for an unknown keyId', async () => {
    const store = await makeStore();
    const record = makeRecord('00000000000000a1', {
      scopes: ['quotes:read', 'intents:write'],
      tier: 'partner',
      maxIntentAmount: '250.5',
      expiresAt: '2027-01-01T00:00:00.000Z',
    });
    await store.create(record);
    expect(await store.get(record.keyId)).toEqual(record);
    expect(await store.get('00000000000000ff')).toBeNull();
  });

  it('round-trips null optional fields as null', async () => {
    const store = await makeStore();
    const record = makeRecord('00000000000000a2');
    await store.create(record);
    const got = await store.get(record.keyId);
    expect(got?.maxIntentAmount).toBeNull();
    expect(got?.expiresAt).toBeNull();
    expect(got?.revokedAt).toBeNull();
    expect(got?.lastUsedAt).toBeNull();
  });

  it('returns copies: changing a record after create or after a read does not change the store', async () => {
    const store = await makeStore();
    const record = makeRecord('00000000000000a3');
    await store.create(record);
    record.scopes.push('admin');
    record.name = 'changed after create';

    const got = await store.get(record.keyId);
    got?.scopes.push('admin');
    const [listed] = await store.list();
    listed?.scopes.push('admin');

    const again = await store.get(record.keyId);
    expect(again?.scopes).toEqual(['quotes:read']);
    expect(again?.name).toBe('key 00000000000000a3');
  });

  it('a duplicate create throws and keeps the original hash', async () => {
    const store = await makeStore();
    const record = makeRecord('00000000000000a4');
    await store.create(record);
    await expect(store.create({ ...record, hash: 'b'.repeat(64) })).rejects.toThrow(
      'api key already exists'
    );
    expect((await store.get(record.keyId))?.hash).toBe(record.hash);
    expect(await store.list()).toHaveLength(1);
  });

  it('list is newest createdAt first, whatever the insertion order', async () => {
    const store = await makeStore();
    await store.create(makeRecord('00000000000000b2', { createdAt: '2026-02-01T00:00:00.000Z' }));
    await store.create(makeRecord('00000000000000b3', { createdAt: '2026-03-01T00:00:00.000Z' }));
    await store.create(makeRecord('00000000000000b1', { createdAt: '2026-01-01T00:00:00.000Z' }));
    expect((await store.list()).map((r) => r.keyId)).toEqual([
      '00000000000000b3',
      '00000000000000b2',
      '00000000000000b1',
    ]);
  });

  it('list is empty for a new store', async () => {
    const store = await makeStore();
    expect(await store.list()).toEqual([]);
  });

  it('revoke is true once, false after that and false for an unknown keyId', async () => {
    const store = await makeStore();
    const record = makeRecord('00000000000000a5');
    await store.create(record);
    expect(await store.revoke(record.keyId, '2026-06-01T00:00:00.000Z')).toBe(true);
    expect(await store.revoke(record.keyId, '2026-06-02T00:00:00.000Z')).toBe(false);
    expect(await store.revoke('00000000000000ff', '2026-06-01T00:00:00.000Z')).toBe(false);
    // The first revocation time stands.
    expect((await store.get(record.keyId))?.revokedAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('touch sets lastUsedAt, moves it forward and is a no-op for an unknown keyId', async () => {
    const store = await makeStore();
    const record = makeRecord('00000000000000a6');
    await store.create(record);
    await store.touch(record.keyId, '2026-06-01T00:00:00.000Z');
    expect((await store.get(record.keyId))?.lastUsedAt).toBe('2026-06-01T00:00:00.000Z');
    await store.touch(record.keyId, '2026-06-03T00:00:00.000Z');
    expect((await store.get(record.keyId))?.lastUsedAt).toBe('2026-06-03T00:00:00.000Z');

    await expect(store.touch('00000000000000ff', '2026-06-01T00:00:00.000Z')).resolves.toBe(
      undefined
    );
    expect(await store.get('00000000000000ff')).toBeNull();
    expect(await store.list()).toHaveLength(1);
  });

  it('touch does not revoke and revoke does not touch', async () => {
    const store = await makeStore();
    const record = makeRecord('00000000000000a7');
    await store.create(record);
    await store.touch(record.keyId, '2026-06-01T00:00:00.000Z');
    expect((await store.get(record.keyId))?.revokedAt).toBeNull();

    const other = makeRecord('00000000000000a8');
    await store.create(other);
    await store.revoke(other.keyId, '2026-06-01T00:00:00.000Z');
    expect((await store.get(other.keyId))?.lastUsedAt).toBeNull();
  });
}

function makeRecord(keyId: string, overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    keyId,
    displayPrefix: `sik_${keyId}`,
    hash: 'a'.repeat(64),
    name: `key ${keyId}`,
    scopes: ['quotes:read'],
    tier: 'standard',
    maxIntentAmount: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    ...overrides,
  };
}
