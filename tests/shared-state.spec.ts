import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Tests for the cross-instance limiter and lock (#911).
//
// The point of the change is that two *instances* agree. A single-process test
// cannot observe that directly, so these drive the shared-state layer with a
// fake executor and assert the SQL contracts the guarantee actually rests on:
// the limiter's atomic upsert, and the lock's expired-only overwrite.

const ORIGINAL_ENV = { ...process.env };

function resetEnv(): void {
  process.env = { ...ORIGINAL_ENV };
}

/** Minimal in-memory stand-in for the two tables the shared layer uses. */
function makeFakeDb() {
  const buckets = new Map<string, number>();
  const locks = new Map<string, number>();

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('CREATE TABLE')) return { rows: [] };

    if (sql.includes('INSERT INTO rate_limit_buckets')) {
      const [key, windowStart] = params as [string, number];
      const id = `${key}@${windowStart}`;
      const next = (buckets.get(id) ?? 0) + 1;
      buckets.set(id, next);
      return { rows: [{ count: next }] };
    }

    if (sql.includes('DELETE FROM rate_limit_buckets')) {
      const [cutoff] = params as [number];
      for (const id of [...buckets.keys()]) {
        if (Number(id.split('@')[1]) < cutoff) buckets.delete(id);
      }
      return { rows: [] };
    }

    if (sql.includes('INSERT INTO advisory_locks')) {
      const [key, expiresAt, now] = params as [string, number, number];
      const held = locks.get(key);
      // Mirrors `DO UPDATE ... WHERE advisory_locks.expires_at <= $3`.
      if (held !== undefined && held > now) return { rows: [] };
      locks.set(key, expiresAt);
      return { rows: [{ lock_key: key }] };
    }

    if (sql.includes('DELETE FROM advisory_locks')) {
      locks.delete((params as [string])[0]);
      return { rows: [] };
    }

    if (sql.includes('SELECT 1 FROM advisory_locks')) {
      const [key, now] = params as [string, number];
      const held = locks.get(key);
      return { rows: held !== undefined && held > now ? [{ '?column?': 1 }] : [] };
    }

    return { rows: [] };
  });

  return { query, buckets, locks };
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

  const rateLimit = await import('@/lib/api/rate-limit');
  const lock = await import('@/lib/reputation/lock');
  return { db, ...rateLimit, ...lock };
}

describe('shared rate limiter (#911)', () => {
  beforeEach(() => {
    vi.resetModules();
    resetEnv();
  });

  afterEach(() => {
    vi.doUnmock('@/lib/reputation/pool');
    resetEnv();
  });

  it('counts through shared state and reports shared: true', async () => {
    const { checkRateLimit } = await loadWithFakeDb();

    const first = await checkRateLimit('1.2.3.4', { bucket: 'b', maxRequests: 3 });
    expect(first.allowed).toBe(true);
    expect(first.shared).toBe(true);
    expect(first.remaining).toBe(2);
  });

  it('blocks once the shared count passes the cap', async () => {
    const { checkRateLimit } = await loadWithFakeDb();
    const opts = { bucket: 'b', maxRequests: 2 };

    expect((await checkRateLimit('1.2.3.4', opts)).allowed).toBe(true);
    expect((await checkRateLimit('1.2.3.4', opts)).allowed).toBe(true);

    const third = await checkRateLimit('1.2.3.4', opts);
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
    expect(third.retryAfter).toBeGreaterThan(0);
  });

  it('keys the window so separate instances derive the same bucket', async () => {
    const { checkRateLimit, db } = await loadWithFakeDb();
    await checkRateLimit('1.2.3.4', { bucket: 'b', windowMs: 60_000 });

    const insert = db.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO rate_limit_buckets')
    );
    const [, params] = insert as [string, unknown[]];
    const windowStart = params[1] as number;

    // Floored to the window, not "now" — otherwise every instance would open
    // its own window and the cap would multiply by instance count.
    expect(windowStart % 60_000).toBe(0);
  });

  it('falls back to per-instance counting when the backend errors', async () => {
    process.env.DATABASE_URL = 'postgres://user:pw@localhost:5432/testdb';
    vi.doMock('@/lib/reputation/pool', () => ({
      getSqlExecutor: () => ({
        query: async () => {
          throw new Error('connection refused');
        },
      }),
      getPool: () => ({}),
      hasDatabaseUrl: () => true,
      ReputationStoreUnavailableError: class extends Error {},
      _resetPool: async () => {},
    }));

    const { checkRateLimit } = await import('@/lib/api/rate-limit');
    const result = await checkRateLimit('1.2.3.4', { bucket: 'b', maxRequests: 3 });

    // Degraded, but still limiting and still honest about it.
    expect(result.allowed).toBe(true);
    expect(result.shared).toBe(false);
  });

  it('reports shared: false when no backend is configured', async () => {
    delete process.env.DATABASE_URL;
    const { checkRateLimit } = await import('@/lib/api/rate-limit');
    expect((await checkRateLimit('1.2.3.4')).shared).toBe(false);
  });
});

describe('shared lock (#911)', () => {
  beforeEach(() => {
    vi.resetModules();
    resetEnv();
  });

  afterEach(() => {
    vi.doUnmock('@/lib/reputation/pool');
    resetEnv();
  });

  it('refuses a second holder while the lock is live', async () => {
    const { acquireLock } = await loadWithFakeDb();

    expect(await acquireLock('tick', 60_000)).toBe(true);
    // The in-process map would have said true here for a second instance;
    // shared state is what makes this false.
    expect(await acquireLock('tick', 60_000)).toBe(false);
  });

  it('lets a new holder take an expired lock', async () => {
    const { acquireLock, db } = await loadWithFakeDb();

    expect(await acquireLock('tick', 1)).toBe(true);
    db.locks.set('tick', Date.now() - 1000); // simulate expiry
    expect(await acquireLock('tick', 60_000)).toBe(true);
  });

  it('frees the lock on release', async () => {
    const { acquireLock, releaseLock, isLocked } = await loadWithFakeDb();

    expect(await acquireLock('tick', 60_000)).toBe(true);
    expect(await isLocked('tick')).toBe(true);

    await releaseLock('tick');

    expect(await isLocked('tick')).toBe(false);
    expect(await acquireLock('tick', 60_000)).toBe(true);
  });
});
