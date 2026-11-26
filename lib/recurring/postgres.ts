import { getSqlExecutor } from '@/lib/reputation/pool';
import type {
  StandingAuthorizationRecord,
  StandingAuthorizationStore,
  StandingExecutionRecord,
} from './authorization-store';
import type { SignedStandingAuthorization, StandingAuthorizationStatus } from '@/types/recurring';

export const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS recurring_authorizations (
  id            TEXT        PRIMARY KEY,
  terms_hash    TEXT        NOT NULL UNIQUE,
  sender        TEXT        NOT NULL,
  authorization TEXT        NOT NULL,
  status        TEXT        NOT NULL CHECK (status IN ('active', 'paused', 'cancelled')),
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS recurring_executions (
  id                TEXT        PRIMARY KEY,
  authorization_id  TEXT        NOT NULL,
  cycle_number      INT         NOT NULL,
  period_index      INT         NOT NULL,
  amount            TEXT        NOT NULL,
  anchor_id         TEXT        NOT NULL,
  intent_hash       TEXT        NOT NULL,
  transaction_id    TEXT,
  status            TEXT        NOT NULL CHECK (status IN ('confirmed', 'rejected')),
  reject_code       TEXT,
  created_at        TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_recurring_exec_confirmed
  ON recurring_executions (authorization_id, cycle_number)
  WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS idx_recurring_executions_lookup
  ON recurring_executions (authorization_id, cycle_number, created_at);`;

let schemaReady: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = getSqlExecutor()
      .query(SCHEMA_SQL)
      .then(() => undefined)
      .catch((err: unknown) => {
        schemaReady = null;
        throw err;
      });
  }
  return schemaReady;
}

export function _resetRecurringSchema(): void {
  schemaReady = null;
}

function toIso(value: unknown): string {
  return new Date(value as string).toISOString();
}

function rowToRecord(r: Record<string, unknown>): StandingAuthorizationRecord {
  return {
    id: r['id'] as string,
    termsHash: r['terms_hash'] as string,
    authorization: (typeof r['authorization'] === 'string'
      ? JSON.parse(r['authorization'])
      : r['authorization']) as SignedStandingAuthorization,
    status: r['status'] as StandingAuthorizationStatus,
    createdAt: toIso(r['created_at']),
    updatedAt: toIso(r['updated_at']),
  };
}

function rowToExecution(r: Record<string, unknown>): StandingExecutionRecord {
  return {
    id: r['id'] as string,
    authorizationId: r['authorization_id'] as string,
    cycleNumber: Number(r['cycle_number']),
    periodIndex: Number(r['period_index']),
    amount: r['amount'] as string,
    anchorId: r['anchor_id'] as string,
    intentHash: r['intent_hash'] as string,
    transactionId: (r['transaction_id'] as string | null) ?? null,
    status: r['status'] as 'confirmed' | 'rejected',
    rejectCode: (r['reject_code'] as string | null) ?? null,
    createdAt: toIso(r['created_at']),
  };
}

export class PostgresStandingAuthorizationStore implements StandingAuthorizationStore {
  async create(
    record: StandingAuthorizationRecord
  ): Promise<{ ok: true } | { ok: false; code: 'duplicate' }> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      `INSERT INTO recurring_authorizations (
         id, terms_hash, sender, authorization, status, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        record.id,
        record.termsHash,
        record.authorization.terms.sender,
        JSON.stringify(record.authorization),
        record.status,
        record.createdAt,
        record.updatedAt,
      ]
    );
    if (rows.length === 0) {
      return { ok: false, code: 'duplicate' };
    }
    return { ok: true };
  }

  async get(id: string): Promise<StandingAuthorizationRecord | null> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      `SELECT id, terms_hash, sender, authorization, status, created_at, updated_at
         FROM recurring_authorizations
        WHERE id = $1`,
      [id]
    );
    const row = rows[0];
    return row ? rowToRecord(row) : null;
  }

  async setStatus(
    id: string,
    status: StandingAuthorizationStatus,
    updatedAt: string
  ): Promise<StandingAuthorizationRecord | null> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      `UPDATE recurring_authorizations
          SET status = $2, updated_at = $3
        WHERE id = $1
      RETURNING *`,
      [id, status, updatedAt]
    );
    const row = rows[0];
    return row ? rowToRecord(row) : null;
  }

  async appendExecution(
    exec: StandingExecutionRecord
  ): Promise<{ ok: true } | { ok: false; code: 'duplicate_cycle' }> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      `INSERT INTO recurring_executions (
         id, authorization_id, cycle_number, period_index, amount,
         anchor_id, intent_hash, transaction_id, status, reject_code, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        exec.id,
        exec.authorizationId,
        exec.cycleNumber,
        exec.periodIndex,
        exec.amount,
        exec.anchorId,
        exec.intentHash,
        exec.transactionId,
        exec.status,
        exec.rejectCode,
        exec.createdAt,
      ]
    );
    if (rows.length === 0) {
      return { ok: false, code: 'duplicate_cycle' };
    }
    return { ok: true };
  }

  async listExecutions(authorizationId: string): Promise<StandingExecutionRecord[]> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      `SELECT id, authorization_id, cycle_number, period_index, amount,
              anchor_id, intent_hash, transaction_id, status, reject_code, created_at
         FROM recurring_executions
        WHERE authorization_id = $1
        ORDER BY cycle_number ASC, created_at ASC`,
      [authorizationId]
    );
    return rows.map(rowToExecution);
  }
}
