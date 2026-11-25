import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEvent } from '@/lib/audit/types';

// Tests for the Postgres-backed audit store (#2206).
//
// Drives PostgresAuditStore with a fake executor, in the style of
// webhooks-postgres-store.spec.ts, and asserts the query shapes and conversions.

const ORIGINAL_ENV = { ...process.env };

function makeFakeDb() {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX')) {
      return { rows: [] };
    }

    if (sql.includes('INSERT INTO audit_log')) {
      return { rows: [] };
    }

    if (sql.includes('SELECT') && sql.includes('FROM audit_log')) {
      return {
        rows: [
          {
            id: 'evt-1',
            at: new Date('2026-11-21T10:00:00.000Z'),
            request_id: 'req-1',
            surface: 'rest',
            action: 'v1.intent.offramp',
            caller_id: 'key:0123456789abcdef',
            caller_kind: 'key',
            scope: 'intents:write',
            intent_hash: 'a'.repeat(64),
            outcome: 'ok',
            status: 200,
          },
        ],
      };
    }

    return { rows: [] };
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

  const { PostgresAuditStore, _resetAuditSchema } = await import('@/lib/audit/postgres');
  _resetAuditSchema();
  return { db, store: new PostgresAuditStore() };
}

describe('lib/audit/postgres.ts (AGS013)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('asserts INSERT parameter order and structure', async () => {
    const { db, store } = await loadWithFakeDb();

    const event: AuditEvent = {
      id: 'uuid-1',
      at: '2026-11-21T12:00:00.000Z',
      requestId: 'req-123',
      surface: 'rest',
      action: 'v1.intent.offramp',
      callerId: 'key:abc',
      callerKind: 'key',
      scope: 'intents:write',
      intentHash: 'c'.repeat(64),
      outcome: 'ok',
      status: 200,
    };

    await store.append(event);

    const insertCall = db.query.mock.calls.find((call) =>
      (call[0] as string).includes('INSERT INTO audit_log')
    );
    expect(insertCall).toBeDefined();

    const params = insertCall![1];
    expect(params).toEqual([
      event.id,
      event.at,
      event.requestId,
      event.surface,
      event.action,
      event.callerId,
      event.callerKind,
      event.scope,
      event.intentHash,
      event.outcome,
      event.status,
    ]);
  });

  it('converts Date columns to ISO strings on listRange', async () => {
    const { store } = await loadWithFakeDb();

    const events = await store.listRange({
      from: '2026-11-21T00:00:00.000Z',
      to: '2026-11-21T23:59:59.000Z',
      limit: 10,
    });

    expect(events.length).toBe(1);
    expect(events[0]!.at).toBe('2026-11-21T10:00:00.000Z');
    expect(typeof events[0]!.at).toBe('string');
  });

  it('includes caller_id filter in listRange SQL when specified', async () => {
    const { db, store } = await loadWithFakeDb();

    await store.listRange({
      from: '2026-11-21T00:00:00.000Z',
      to: '2026-11-21T23:59:59.000Z',
      limit: 10,
      callerId: 'key:0123456789abcdef',
    });

    const selectCall = db.query.mock.calls.find(
      (call) =>
        (call[0] as string).includes('SELECT') && (call[0] as string).includes('FROM audit_log')
    );
    expect(selectCall).toBeDefined();
    const sql = selectCall![0] as string;
    const params = selectCall![1] as unknown[];

    expect(sql).toContain('caller_id = $3');
    expect(params[0]).toBe('2026-11-21T00:00:00.000Z');
    expect(params[1]).toBe('2026-11-21T23:59:59.000Z');
    expect(params[2]).toBe('key:0123456789abcdef');
    expect(params[3]).toBe(10);
  });
});
