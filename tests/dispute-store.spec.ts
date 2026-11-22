import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InMemoryDisputeStore,
  PostgresDisputeStore,
  _resetDisputeSchema,
  _setDisputeStore,
  getDisputeStore,
  type Dispute,
} from '@/lib/reputation/disputes';
import { levelDeadline } from '@/lib/reputation/dispute-ladder';

const executor = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('@/lib/reputation/pool', () => ({
  getSqlExecutor: () => executor,
  hasDatabaseUrl: () => Boolean(process.env.DATABASE_URL),
}));

function dispute(overrides: Partial<Dispute> = {}): Dispute {
  const createdAt = overrides.createdAt ?? '2026-10-01T10:00:00.000Z';
  const level = overrides.level ?? 'review';
  return {
    id: 'd-1',
    intentHash: 'a'.repeat(64),
    publicKey: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    anchorId: 'moneygram',
    reason: 'never settled',
    status: 'open',
    createdAt,
    resolvedAt: null,
    category: 'other',
    level,
    levelDeadline: overrides.levelDeadline ?? levelDeadline(level, createdAt),
    subjectKind: 'outcome',
    subjectRef: 'a'.repeat(64),
    appealedAt: null,
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

  it('escalates an open dispute', async () => {
    await store.create(dispute({ level: 'anchor' }));
    const escalated = await store.escalate('d-1', 'review', '2026-10-08T00:00:00.000Z');
    expect(escalated?.level).toBe('review');
    expect(escalated?.levelDeadline).toBe('2026-10-08T00:00:00.000Z');
  });

  it('returns null when escalating a resolved dispute or unknown id', async () => {
    await store.create(dispute({ status: 'accepted' }));
    expect(await store.escalate('d-1', 'review', '2026-10-08T00:00:00.000Z')).toBeNull();
    expect(await store.escalate('missing', 'review', '2026-10-08T00:00:00.000Z')).toBeNull();
  });

  it('finds disputes by intentHash newest first', async () => {
    const hash = 'b'.repeat(64);
    await store.create(
      dispute({ id: 'd1', intentHash: hash, createdAt: '2026-10-01T10:00:00.000Z' })
    );
    await store.create(
      dispute({ id: 'd2', intentHash: hash, createdAt: '2026-10-02T10:00:00.000Z' })
    );
    await store.create(dispute({ id: 'other', intentHash: 'c'.repeat(64) }));

    const found = await store.findByIntentHash(hash);
    expect(found.map((d) => d.id)).toEqual(['d2', 'd1']);
  });

  it('finds disputes by subject newest first', async () => {
    await store.create(
      dispute({
        id: 'd1',
        subjectKind: 'refund',
        subjectRef: 'ref-1',
        createdAt: '2026-10-01T10:00:00.000Z',
      })
    );
    await store.create(
      dispute({
        id: 'd2',
        subjectKind: 'refund',
        subjectRef: 'ref-1',
        createdAt: '2026-10-02T10:00:00.000Z',
      })
    );

    const found = await store.findBySubject('refund', 'ref-1');
    expect(found.map((d) => d.id)).toEqual(['d2', 'd1']);
  });

  it('does not let callers mutate stored state', async () => {
    await store.create(dispute());
    const fetched = await store.get('d-1');
    if (fetched) fetched.reason = 'tampered';
    expect((await store.get('d-1'))?.reason).toBe('never settled');
  });
});

describe('PostgresDisputeStore', () => {
  function fakeTable() {
    const rows = new Map<string, Record<string, unknown>>();
    executor.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (
        sql.includes('CREATE TABLE') ||
        sql.includes('ALTER TABLE') ||
        sql.includes('CREATE INDEX')
      ) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO disputes')) {
        const [
          id,
          intent_hash,
          public_key,
          anchor_id,
          reason,
          status,
          created_at,
          resolved_at,
          category,
          level,
          level_deadline,
          subject_kind,
          subject_ref,
          appealed_at,
        ] = params;
        rows.set(String(id), {
          id,
          intent_hash,
          public_key,
          anchor_id,
          reason,
          status,
          created_at,
          resolved_at,
          category,
          level,
          level_deadline,
          subject_kind,
          subject_ref,
          appealed_at,
        });
        return { rows: [] };
      }
      if (sql.includes('UPDATE disputes SET status = $2')) {
        const [id, status, resolvedAt] = params;
        const found = rows.get(String(id));
        if (!found) return { rows: [] };
        const updated = { ...found, status, resolved_at: resolvedAt };
        rows.set(String(id), updated);
        return { rows: [updated] };
      }
      if (sql.includes('UPDATE disputes SET level = $2')) {
        const [id, level, levelDeadline] = params;
        const found = rows.get(String(id));
        if (!found || found['status'] !== 'open') return { rows: [] };
        const updated = { ...found, level, level_deadline: levelDeadline };
        rows.set(String(id), updated);
        return { rows: [updated] };
      }
      if (sql.includes('WHERE id = $1')) {
        const found = rows.get(String(params[0]));
        return { rows: found ? [found] : [] };
      }
      if (sql.includes('WHERE intent_hash = $1')) {
        const found = [...rows.values()].filter((r) => r['intent_hash'] === params[0]);
        return { rows: found };
      }
      if (sql.includes('WHERE subject_kind = $1 AND subject_ref = $2')) {
        const found = [...rows.values()].filter(
          (r) => r['subject_kind'] === params[0] && r['subject_ref'] === params[1]
        );
        return { rows: found };
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

  it('creates the table and runs migrations once per process', async () => {
    const store = new PostgresDisputeStore();
    await store.create(dispute({ id: 'a' }));
    await store.create(dispute({ id: 'b' }));
    const ddl = executor.query.mock.calls.filter(([sql]) => String(sql).includes('CREATE TABLE'));
    expect(ddl).toHaveLength(1);
    const sqlText = String(ddl[0]?.[0]);
    expect(sqlText).toContain('ALTER TABLE disputes ADD COLUMN IF NOT EXISTS category');
    expect(sqlText).toContain('ALTER TABLE disputes ADD COLUMN IF NOT EXISTS level');
    expect(sqlText).toContain('ALTER TABLE disputes ADD COLUMN IF NOT EXISTS level_deadline');
    expect(sqlText).toContain('ALTER TABLE disputes ADD COLUMN IF NOT EXISTS subject_kind');
    expect(sqlText).toContain('ALTER TABLE disputes ADD COLUMN IF NOT EXISTS subject_ref');
    expect(sqlText).toContain('ALTER TABLE disputes ADD COLUMN IF NOT EXISTS appealed_at');
    expect(sqlText).toContain('CREATE INDEX IF NOT EXISTS disputes_intent_hash_idx');
  });

  it('maps legacy rows with null level_deadline and null subject_ref', async () => {
    const store = new PostgresDisputeStore();
    // Simulate legacy row inserted without level_deadline
    executor.query.mockImplementationOnce(async () => ({ rows: [] })); // ensureSchema
    executor.query.mockImplementationOnce(async () => ({
      rows: [
        {
          id: 'legacy-1',
          intent_hash: 'hash-123',
          public_key: 'G...',
          anchor_id: 'cowrie',
          reason: 'legacy',
          status: 'open',
          created_at: '2026-01-01T00:00:00.000Z',
          resolved_at: null,
          category: 'other',
          level: 'anchor',
          level_deadline: null,
          subject_kind: 'outcome',
          subject_ref: null,
          appealed_at: null,
        },
      ],
    }));

    const result = await store.get('legacy-1');
    expect(result).not.toBeNull();
    expect(result?.levelDeadline).toBe('2026-01-04T00:00:00.000Z'); // 72h after Jan 1
    expect(result?.subjectRef).toBe('hash-123'); // defaults to intentHash on outcome
  });

  it('escalates dispute in postgres', async () => {
    const store = new PostgresDisputeStore();
    await store.create(dispute({ id: 'esc-1', level: 'anchor' }));
    const res = await store.escalate('esc-1', 'review', '2026-10-10T00:00:00.000Z');
    expect(res?.level).toBe('review');
    expect(res?.levelDeadline).toBe('2026-10-10T00:00:00.000Z');
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
});
