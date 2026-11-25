import { describe, expect, it, beforeEach } from 'vitest';
import {
  getApiKeyStore,
  InMemoryApiKeyStore,
  _setApiKeyStore,
  type ApiKeyRecord,
} from '@/lib/auth/key-store';

function makeRecord(id: string, createdAt = '2026-11-21T10:00:00.000Z'): ApiKeyRecord {
  return {
    keyId: id,
    displayPrefix: `sik_${id}`,
    hash: 'h'.repeat(64),
    name: `Test Key ${id}`,
    scopes: ['quotes:read'],
    tier: 'standard',
    maxIntentAmount: null,
    createdAt,
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
  };
}

describe('lib/auth/key-store.ts (AGS002)', () => {
  let store: InMemoryApiKeyStore;

  beforeEach(() => {
    store = new InMemoryApiKeyStore();
    _setApiKeyStore(store);
  });

  it('create and get round-trip, returning defensive copies', async () => {
    const record = makeRecord('0123456789abcdef');
    await store.create(record);

    const retrieved = await store.get(record.keyId);
    expect(retrieved).toEqual(record);

    // Modifying retrieved does not mutate store internal state
    retrieved!.scopes.push('admin');
    const retrievedAgain = await store.get(record.keyId);
    expect(retrievedAgain!.scopes).toEqual(['quotes:read']);
  });

  it('duplicate create throws', async () => {
    const record = makeRecord('0123456789abcdef');
    await store.create(record);
    await expect(store.create(record)).rejects.toThrow('api key already exists');
  });

  it('list sorts newest createdAt first', async () => {
    await store.create(makeRecord('0000000000000001', '2026-11-21T09:00:00.000Z'));
    await store.create(makeRecord('0000000000000002', '2026-11-21T11:00:00.000Z'));
    await store.create(makeRecord('0000000000000003', '2026-11-21T10:00:00.000Z'));

    const list = await store.list();
    expect(list.map((k) => k.keyId)).toEqual([
      '0000000000000002',
      '0000000000000003',
      '0000000000000001',
    ]);
  });

  it('revoke returns true once, false on subsequent call, false for unknown', async () => {
    const record = makeRecord('0123456789abcdef');
    await store.create(record);

    expect(await store.revoke('unknown-id', '2026-11-21T12:00:00.000Z')).toBe(false);
    expect(await store.revoke(record.keyId, '2026-11-21T12:00:00.000Z')).toBe(true);
    expect(await store.revoke(record.keyId, '2026-11-21T12:00:00.000Z')).toBe(false);

    const revoked = await store.get(record.keyId);
    expect(revoked!.revokedAt).toBe('2026-11-21T12:00:00.000Z');
  });

  it('touch sets lastUsedAt and no-ops for unknown keyId', async () => {
    const record = makeRecord('0123456789abcdef');
    await store.create(record);

    await store.touch('unknown-id', '2026-11-21T12:00:00.000Z');
    await store.touch(record.keyId, '2026-11-21T12:00:00.000Z');

    const touched = await store.get(record.keyId);
    expect(touched!.lastUsedAt).toBe('2026-11-21T12:00:00.000Z');
  });

  it('getApiKeyStore returns in-memory store when DATABASE_URL is empty', () => {
    _setApiKeyStore(null);
    delete process.env.DATABASE_URL;
    const s = getApiKeyStore();
    expect(s).toBeInstanceOf(InMemoryApiKeyStore);
  });
});
