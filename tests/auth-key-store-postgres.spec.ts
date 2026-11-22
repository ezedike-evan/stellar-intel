import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiKeyRecord } from '@/lib/auth/key-store';

// Drives PostgresApiKeyStore with a fake executor, as webhooks-postgres-store.spec.ts
// does. TIMESTAMPTZ columns come back as Date objects, as pg returns them.

const ORIGINAL_ENV = { ...process.env };

function makeFakeDb() {
  const rows = new Map<string, Record<string, unknown>>();
  const toDate = (v: unknown) => (v == null ? null : new Date(v as string));

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('CREATE TABLE')) return { rows: [] };

    if (sql.includes('INSERT INTO api_keys')) {
      const [keyId, prefix, hash, name, scopes, tier, max, created, expires, revoked, used] =
        params;
      if (rows.has(keyId as string)) return { rows: [] };
      rows.set(keyId as string, {
        key_id: keyId,
        display_prefix: prefix,
        key_hash: hash,
        name,
        scopes,
        tier,
        max_intent_amount: max,
        created_at: toDate(created),
        expires_at: toDate(expires),
        revoked_at: toDate(revoked),
        last_used_at: toDate(used),
      });
      return { rows: [{ key_id: keyId }] };
    }

    if (sql.includes('SET revoked_at')) {
      const [keyId, at] = params as [string, string];
      const row = rows.get(keyId);
      if (!row || row['revoked_at'] != null) return { rows: [] };
      row['revoked_at'] = new Date(at);
      return { rows: [{ key_id: keyId }] };
    }

    if (sql.includes('SET last_used_at')) {
      const [keyId, at] = params as [string, string];
      const row = rows.get(keyId);
      if (row) row['last_used_at'] = new Date(at);
      return { rows: [] };
    }

    if (sql.includes('WHERE key_id = $1')) {
      const row = rows.get((params as [string])[0]);
      return { rows: row ? [{ ...row }] : [] };
    }

    if (sql.includes('FROM api_keys')) {
      return {
        rows: [...rows.values()].sort(
          (a, b) => (b['created_at'] as Date).getTime() - (a['created_at'] as Date).getTime()
        ),
      };
    }

    throw new Error(`unexpected SQL: ${sql}`);
  });

  return { query };
}

async function loadWithFakeDb() {
  process.env.DATABASE_URL = 'postgres://user:pw@localhost:5432/testdb';
  const db = makeFakeDb();

  vi.doMock('@/lib/reputation/pool', () => ({
    getSqlExecutor: () => db,
    getPool: () => db,
    hasDatabaseUrl: () => true,
    ReputationStoreUnavailableError: class extends Error {},
    _resetPool: async () => {},
  }));

  const mod = await import('@/lib/auth/key-store-postgres');
  mod._resetApiKeySchema();
  return { db, store: new mod.PostgresApiKeyStore() };
}

const RECORD: ApiKeyRecord = {
  keyId: '0123456789abcdef',
  displayPrefix: 'sik_0123456789abcdef',
  hash: 'a'.repeat(64),
  name: 'agent',
  scopes: ['quotes:read', 'intents:write'],
  tier: 'partner',
  maxIntentAmount: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2027-01-01T00:00:00.000Z',
  revokedAt: null,
  lastUsedAt: null,
};

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock('@/lib/reputation/pool');
  process.env = { ...ORIGINAL_ENV };
});

describe('PostgresApiKeyStore', () => {
  it('round-trips scopes as JSON, dates as ISO strings and a null maxIntentAmount', async () => {
    const { store } = await loadWithFakeDb();
    await store.create(RECORD);
    const got = await store.get(RECORD.keyId);
    expect(got).toEqual(RECORD);
    expect(got?.maxIntentAmount).toBeNull();
    expect(typeof got?.createdAt).toBe('string');
    expect(await store.list()).toEqual([RECORD]);
  });

  it('throws on a duplicate create and never upserts', async () => {
    const { db, store } = await loadWithFakeDb();
    await store.create(RECORD);
    await expect(store.create({ ...RECORD, hash: 'b'.repeat(64) })).rejects.toThrow(
      'api key already exists'
    );
    expect((await store.get(RECORD.keyId))?.hash).toBe(RECORD.hash);
    const insert = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO api_keys'));
    expect(insert?.[0]).toContain('DO NOTHING');
  });

  it('revokes only once, guarded by revoked_at IS NULL', async () => {
    const { db, store } = await loadWithFakeDb();
    await store.create(RECORD);
    expect(await store.revoke(RECORD.keyId, '2026-06-01T00:00:00.000Z')).toBe(true);
    expect(await store.revoke(RECORD.keyId, '2026-06-02T00:00:00.000Z')).toBe(false);
    const revokeSql = db.query.mock.calls.find(([sql]) => sql.includes('SET revoked_at'))?.[0];
    expect(revokeSql).toContain('revoked_at IS NULL');
    expect((await store.get(RECORD.keyId))?.revokedAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('touch sets lastUsedAt', async () => {
    const { store } = await loadWithFakeDb();
    await store.create(RECORD);
    await store.touch(RECORD.keyId, '2026-06-01T00:00:00.000Z');
    expect((await store.get(RECORD.keyId))?.lastUsedAt).toBe('2026-06-01T00:00:00.000Z');
  });
});
