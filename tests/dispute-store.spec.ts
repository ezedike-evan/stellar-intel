import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InMemoryDisputeStore,
  PostgresDisputeStore,
  _resetDisputeSchema,
  _setDisputeStore,
  getDisputeStore,
  type Dispute,
} from '@/lib/reputation/disputes';

const executor = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('@/lib/reputation/pool', () => ({
  getSqlExecutor: () => executor,
  hasDatabaseUrl: () => Boolean(process.env.DATABASE_URL),
}));

function dispute(overrides: Partial<Dispute> = {}): Dispute {
  return {
    id: 'd-1',
    intentHash: 'a'.repeat(64),
    publicKey: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    anchorId: 'moneygram',
    reason: 'never settled',
    status: 'open',
    createdAt: '2026-10-01T10:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

describe('InMemoryDisputeStore', () => {
  let store: InMemoryDisputeStore;

  beforeEach(() => {
    store = new InMemoryDisputeStore();
  });

  it('creates and gets a dispute', async () => {
    await store.create(dispute());
    expect(await store.get('d-1')).toEqual(dispute());
  });

  it('returns null for an unknown id', async () => {
    expect(await store.get('missing')).toBeNull();
  });

  it('lists disputes newest first', async () => {
    await store.create(dispute({ id: 'old', createdAt: '2026-10-01T10:00:00.000Z' }));
    await store.create(dispute({ id: 'new', createdAt: '2026-10-02T10:00:00.000Z' }));
    expect((await store.list()).map((d) => d.id)).toEqual(['new', 'old']);
  });

  it('resolves a dispute and records when', async () => {
    await store.create(dispute());
    const resolved = await store.resolve('d-1', 'accepted', '2026-10-03T00:00:00.000Z');
    expect(resolved).toMatchObject({
      status: 'accepted',
      resolvedAt: '2026-10-03T00:00:00.000Z',
    });
    expect(await store.get('d-1')).toEqual(resolved);
  });

  it('returns null when resolving an unknown id', async () => {
    expect(await store.resolve('missing', 'rejected', '2026-10-03T00:00:00.000Z')).toBeNull();
  });

  it('does not let callers mutate stored state', async () => {
    await store.create(dispute());
    const fetched = await store.get('d-1');
    if (fetched) fetched.reason = 'tampered';
    expect((await store.get('d-1'))?.reason).toBe('never settled');
  });
});

describe('PostgresDisputeStore', () => {
  /** A tiny fake of the `disputes` table, keyed by id. */
  function fakeTable() {
    const rows = new Map<string, Record<string, unknown>>();
    executor.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('CREATE TABLE')) return { rows: [] };
      if (sql.includes('INSERT INTO disputes')) {
        const [id, intent_hash, public_key, anchor_id, reason, status, created_at, resolved_at] =
          params;
        rows.set(String(id), {
          id,
          intent_hash,
          public_key,
          anchor_id,
          reason,
          status,
          created_at,
          resolved_at,
        });
        return { rows: [] };
      }
      if (sql.includes('UPDATE disputes')) {
        const [id, status, resolvedAt] = params;
        const found = rows.get(String(id));
        if (!found) return { rows: [] };
        const updated = { ...found, status, resolved_at: resolvedAt };
        rows.set(String(id), updated);
        return { rows: [updated] };
      }
      if (sql.includes('WHERE id = $1')) {
        const found = rows.get(String(params[0]));
        return { rows: found ? [found] : [] };
      }
      if (sql.includes('ORDER BY created_at DESC')) {
        return {
          rows: [...rows.values()].sort((a, b) =>
            String(b['created_at']).localeCompare(String(a['created_at']))
          ),
        };
      }
      return { rows: [] };
    });
  }

  beforeEach(() => {
    executor.query.mockReset();
    _resetDisputeSchema();
    fakeTable();
  });

  it('creates the table once per process, not once per call', async () => {
    const store = new PostgresDisputeStore();
    await store.create(dispute({ id: 'a' }));
    await store.create(dispute({ id: 'b' }));
    const ddl = executor.query.mock.calls.filter(([sql]) => String(sql).includes('CREATE TABLE'));
    expect(ddl).toHaveLength(1);
    expect(String(ddl[0]?.[0])).toContain('disputes');
  });

  it('round-trips create, get, list and resolve', async () => {
    const store = new PostgresDisputeStore();
    await store.create(dispute({ id: 'old', createdAt: '2026-10-01T10:00:00.000Z' }));
    await store.create(dispute({ id: 'new', createdAt: '2026-10-02T10:00:00.000Z' }));

    expect(await store.get('old')).toEqual(dispute({ id: 'old' }));
    expect((await store.list()).map((d) => d.id)).toEqual(['new', 'old']);

    const resolved = await store.resolve('old', 'rejected', '2026-10-03T00:00:00.000Z');
    expect(resolved).toMatchObject({ status: 'rejected', resolvedAt: '2026-10-03T00:00:00.000Z' });
  });

  it('returns null for an unknown id on get and resolve', async () => {
    const store = new PostgresDisputeStore();
    expect(await store.get('missing')).toBeNull();
    expect(await store.resolve('missing', 'accepted', '2026-10-03T00:00:00.000Z')).toBeNull();
  });

  it('retries the DDL after a failed attempt instead of caching the failure', async () => {
    executor.query.mockRejectedValueOnce(new Error('connection refused'));
    const store = new PostgresDisputeStore();
    await expect(store.list()).rejects.toThrow('connection refused');
    await expect(store.list()).resolves.toEqual([]);
  });
});

describe('getDisputeStore', () => {
  beforeEach(() => {
    _setDisputeStore(null);
    vi.unstubAllEnvs();
  });

  it('uses the in-memory store without a database, and keeps it between calls', () => {
    expect(getDisputeStore()).toBeInstanceOf(InMemoryDisputeStore);
    expect(getDisputeStore()).toBe(getDisputeStore());
  });

  it('uses Postgres when DATABASE_URL is set', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://user:pw@localhost:5432/db');
    expect(getDisputeStore()).toBeInstanceOf(PostgresDisputeStore);
  });

  it('honours an injected store, and drops it on reset', () => {
    const injected = new InMemoryDisputeStore();
    _setDisputeStore(injected);
    expect(getDisputeStore()).toBe(injected);
    _setDisputeStore(null);
    expect(getDisputeStore()).not.toBe(injected);
  });
});
