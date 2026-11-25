import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type {
  StandingAuthorizationRecord,
  StandingExecutionRecord,
} from '@/lib/recurring/authorization-store';
import type { SignedStandingAuthorization } from '@/types/recurring';

const ORIGINAL_ENV = { ...process.env };

function resetEnv(): void {
  process.env = { ...ORIGINAL_ENV };
}

function makeAuth(
  overrides: Partial<SignedStandingAuthorization> = {}
): SignedStandingAuthorization {
  return {
    terms: {
      type: 'recurring-authorization',
      version: 1,
      sender: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      corridorId: 'usdc-ngn',
      sourceAsset: 'USDC',
      destinationAsset: 'NGN',
      amount: '100',
      perPeriodCap: '500',
      period: 'monthly',
      startAt: '2026-01-01T00:00:00.000Z',
      stopAt: '2026-12-31T23:59:59.000Z',
      anchorAllowlist: ['cowrie'],
      nonce: '0123456789abcdef0123456789abcdef',
    },
    termsHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    signature: 'sig...',
    publicKey: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    ...overrides,
  };
}

function makeRecord(
  overrides: Partial<StandingAuthorizationRecord> = {}
): StandingAuthorizationRecord {
  const auth = makeAuth();
  return {
    id: 'auth-1',
    termsHash: auth.termsHash,
    authorization: auth,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeExecution(overrides: Partial<StandingExecutionRecord> = {}): StandingExecutionRecord {
  return {
    id: 'exec-1',
    authorizationId: 'auth-1',
    cycleNumber: 1,
    periodIndex: 0,
    amount: '100',
    anchorId: 'cowrie',
    intentHash: 'hash-1',
    transactionId: 'tx-1',
    status: 'confirmed',
    rejectCode: null,
    createdAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function makeFakeDb() {
  const auths = new Map<string, Record<string, unknown>>();
  const termsHashes = new Set<string>();
  const executions: Record<string, unknown>[] = [];
  const queryLog: string[] = [];

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    queryLog.push(sql);
    if (
      sql.includes('CREATE TABLE') ||
      sql.includes('CREATE UNIQUE INDEX') ||
      sql.includes('CREATE INDEX')
    ) {
      return { rows: [] };
    }

    if (sql.includes('INSERT INTO recurring_authorizations')) {
      const [id, termsHash, sender, authorization, status, createdAt, updatedAt] = params as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      if (auths.has(id) || termsHashes.has(termsHash)) {
        return { rows: [] }; // ON CONFLICT DO NOTHING
      }
      const row = {
        id,
        terms_hash: termsHash,
        sender,
        authorization,
        status,
        created_at: new Date(createdAt),
        updated_at: new Date(updatedAt),
      };
      auths.set(id, row);
      termsHashes.add(termsHash);
      return { rows: [{ id }] };
    }

    if (sql.includes('FROM recurring_authorizations') && sql.includes('WHERE id = $1')) {
      const id = (params as [string])[0];
      const row = auths.get(id);
      return { rows: row ? [row] : [] };
    }

    if (sql.includes('UPDATE recurring_authorizations')) {
      const [id, status, updatedAt] = params as [string, string, string];
      const row = auths.get(id);
      if (!row) return { rows: [] };
      row['status'] = status;
      row['updated_at'] = new Date(updatedAt);
      return { rows: [row] };
    }

    if (sql.includes('INSERT INTO recurring_executions')) {
      const [
        id,
        authId,
        cycleNumber,
        periodIndex,
        amount,
        anchorId,
        intentHash,
        txId,
        status,
        rejectCode,
        createdAt,
      ] = params as [
        string,
        string,
        number,
        number,
        string,
        string,
        string,
        string | null,
        string,
        string | null,
        string,
      ];

      if (
        status === 'confirmed' &&
        executions.some(
          (e) =>
            e['authorization_id'] === authId &&
            e['cycle_number'] === cycleNumber &&
            e['status'] === 'confirmed'
        )
      ) {
        return { rows: [] }; // Unique index on (authorization_id, cycle_number) where status = 'confirmed'
      }

      const row = {
        id,
        authorization_id: authId,
        cycle_number: cycleNumber,
        period_index: periodIndex,
        amount,
        anchor_id: anchorId,
        intent_hash: intentHash,
        transaction_id: txId,
        status,
        reject_code: rejectCode,
        created_at: new Date(createdAt),
      };
      executions.push(row);
      return { rows: [{ id }] };
    }

    if (sql.includes('FROM recurring_executions') && sql.includes('authorization_id = $1')) {
      const authId = (params as [string])[0];
      const rows = executions
        .filter((e) => e['authorization_id'] === authId)
        .sort((a, b) => {
          if ((a['cycle_number'] as number) !== (b['cycle_number'] as number)) {
            return (a['cycle_number'] as number) - (b['cycle_number'] as number);
          }
          return (a['created_at'] as Date).getTime() - (b['created_at'] as Date).getTime();
        });
      return { rows };
    }

    return { rows: [] };
  });

  return { query, queryLog };
}

describe('PostgresStandingAuthorizationStore (#2169)', () => {
  beforeEach(() => {
    vi.resetModules();
    resetEnv();
  });

  afterEach(() => {
    vi.doUnmock('@/lib/reputation/pool');
    resetEnv();
  });

  it('create, then duplicate gives duplicate', async () => {
    process.env.DATABASE_URL = 'postgres://user:pw@localhost:5432/testdb';
    const db = makeFakeDb();

    vi.doMock('@/lib/reputation/pool', () => ({
      getSqlExecutor: () => db,
      hasDatabaseUrl: () => true,
    }));

    const { PostgresStandingAuthorizationStore } = await import('@/lib/recurring/postgres');
    const store = new PostgresStandingAuthorizationStore();

    const record = makeRecord();
    const res1 = await store.create(record);
    expect(res1).toEqual({ ok: true });

    const dup = makeRecord({ id: 'auth-2', termsHash: record.termsHash });
    const res2 = await store.create(dup);
    expect(res2).toEqual({ ok: false, code: 'duplicate' });
  });

  it('confirmed duplicate cycle gives duplicate_cycle', async () => {
    process.env.DATABASE_URL = 'postgres://user:pw@localhost:5432/testdb';
    const db = makeFakeDb();

    vi.doMock('@/lib/reputation/pool', () => ({
      getSqlExecutor: () => db,
      hasDatabaseUrl: () => true,
    }));

    const { PostgresStandingAuthorizationStore } = await import('@/lib/recurring/postgres');
    const store = new PostgresStandingAuthorizationStore();

    const exec1 = makeExecution({ id: 'e1', cycleNumber: 1, status: 'confirmed' });
    expect(await store.appendExecution(exec1)).toEqual({ ok: true });

    const exec2 = makeExecution({ id: 'e2', cycleNumber: 1, status: 'confirmed' });
    expect(await store.appendExecution(exec2)).toEqual({ ok: false, code: 'duplicate_cycle' });
  });

  it('setStatus round-trip with ISO strings', async () => {
    process.env.DATABASE_URL = 'postgres://user:pw@localhost:5432/testdb';
    const db = makeFakeDb();

    vi.doMock('@/lib/reputation/pool', () => ({
      getSqlExecutor: () => db,
      hasDatabaseUrl: () => true,
    }));

    const { PostgresStandingAuthorizationStore } = await import('@/lib/recurring/postgres');
    const store = new PostgresStandingAuthorizationStore();

    const record = makeRecord();
    await store.create(record);

    const updated = await store.setStatus(record.id, 'paused', '2026-01-05T12:00:00.000Z');
    expect(updated).not.toBeNull();
    expect(updated?.status).toBe('paused');
    expect(updated?.updatedAt).toBe('2026-01-05T12:00:00.000Z');

    const fetched = await store.get(record.id);
    expect(fetched?.status).toBe('paused');
    expect(fetched?.updatedAt).toBe('2026-01-05T12:00:00.000Z');
  });

  it('schema SQL is run once across two calls, and runs again after _resetRecurringSchema()', async () => {
    process.env.DATABASE_URL = 'postgres://user:pw@localhost:5432/testdb';
    const db = makeFakeDb();

    vi.doMock('@/lib/reputation/pool', () => ({
      getSqlExecutor: () => db,
      hasDatabaseUrl: () => true,
    }));

    const { PostgresStandingAuthorizationStore, _resetRecurringSchema } =
      await import('@/lib/recurring/postgres');
    _resetRecurringSchema();
    const store = new PostgresStandingAuthorizationStore();

    await store.get('test-1');
    const schemaCallsFirst = db.queryLog.filter((sql) => sql.includes('CREATE TABLE')).length;
    expect(schemaCallsFirst).toBe(1);

    await store.get('test-2');
    const schemaCallsSecond = db.queryLog.filter((sql) => sql.includes('CREATE TABLE')).length;
    expect(schemaCallsSecond).toBe(1);

    _resetRecurringSchema();
    await store.get('test-3');
    const schemaCallsThird = db.queryLog.filter((sql) => sql.includes('CREATE TABLE')).length;
    expect(schemaCallsThird).toBe(2);
  });

  it('the getter picks Postgres only when DATABASE_URL is set', async () => {
    const { getStandingAuthorizationStore, _setStandingAuthorizationStore } =
      await import('@/lib/recurring/authorization-store');
    const { PostgresStandingAuthorizationStore } = await import('@/lib/recurring/postgres');
    const { InMemoryStandingAuthorizationStore } =
      await import('@/lib/recurring/authorization-store');

    // 1. With DATABASE_URL unset
    delete process.env.DATABASE_URL;
    _setStandingAuthorizationStore(null);
    const storeNoDb = getStandingAuthorizationStore();
    expect(storeNoDb instanceof InMemoryStandingAuthorizationStore).toBe(true);

    // 2. With DATABASE_URL set
    process.env.DATABASE_URL = 'postgres://user:pw@localhost:5432/testdb';
    _setStandingAuthorizationStore(null);
    const storeWithDb = getStandingAuthorizationStore();
    expect(storeWithDb instanceof PostgresStandingAuthorizationStore).toBe(true);
  });

  it('migration file and inline SCHEMA_SQL match', async () => {
    const { SCHEMA_SQL } = await import('@/lib/recurring/postgres');
    const migrationPath = join(
      process.cwd(),
      'lib/recurring/migrations/001_standing_authorizations.sql'
    );
    const migrationSql = readFileSync(migrationPath, 'utf8');

    // Extract all CREATE statements from migration file
    const createStatements = migrationSql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.toUpperCase().startsWith('CREATE'));

    expect(createStatements.length).toBeGreaterThan(0);
    for (const stmt of createStatements) {
      // Normalize whitespace for comparison
      const normStmt = stmt.replace(/\s+/g, ' ');
      const normSchema = SCHEMA_SQL.replace(/\s+/g, ' ');
      expect(normSchema).toContain(normStmt);
    }
  });
});
