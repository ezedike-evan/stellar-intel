/**
 * lib/audit/postgres.ts
 *
 * Postgres append-only store for audit events (AGS013).
 * Append-only: only INSERT and SELECT queries are used.
 */

import { getSqlExecutor } from '@/lib/reputation/pool';
import type { AuditEvent, AuditQuery, AuditStore } from './types';

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS audit_log (
    id          TEXT        PRIMARY KEY,
    at          TIMESTAMPTZ NOT NULL,
    request_id  TEXT,
    surface     TEXT        NOT NULL CHECK (surface IN ('rest','mcp','graphql')),
    action      TEXT        NOT NULL,
    caller_id   TEXT        NOT NULL,
    caller_kind TEXT        NOT NULL,
    scope       TEXT,
    intent_hash TEXT,
    outcome     TEXT        NOT NULL CHECK (outcome IN ('ok','client_error','denied','rate_limited','error')),
    status      INT
  );

  CREATE INDEX IF NOT EXISTS idx_audit_log_at
    ON audit_log (at);

  CREATE INDEX IF NOT EXISTS idx_audit_log_caller_at
    ON audit_log (caller_id, at);
`;

const COLUMNS = `id, at, request_id, surface, action, caller_id, caller_kind, scope, intent_hash, outcome, status`;

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

export function _resetAuditSchema(): void {
  schemaReady = null;
}

function toIso(value: unknown): string {
  return new Date(value as string).toISOString();
}

function rowToEvent(r: Record<string, unknown>): AuditEvent {
  return {
    id: r['id'] as string,
    at: toIso(r['at']),
    requestId: (r['request_id'] as string | null) ?? null,
    surface: r['surface'] as AuditEvent['surface'],
    action: r['action'] as string,
    callerId: r['caller_id'] as string,
    callerKind: r['caller_kind'] as AuditEvent['callerKind'],
    scope: (r['scope'] as AuditEvent['scope']) ?? null,
    intentHash: (r['intent_hash'] as string | null) ?? null,
    outcome: r['outcome'] as AuditEvent['outcome'],
    status: (r['status'] as number | null) ?? null,
  };
}

export class PostgresAuditStore implements AuditStore {
  async append(event: AuditEvent): Promise<void> {
    await ensureSchema();
    await getSqlExecutor().query(
      `INSERT INTO audit_log (${COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
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
      ]
    );
  }

  async listRange(q: AuditQuery): Promise<AuditEvent[]> {
    await ensureSchema();
    const params: unknown[] = [q.from, q.to];
    let sql = `SELECT ${COLUMNS} FROM audit_log WHERE at >= $1 AND at < $2`;

    if (q.callerId) {
      params.push(q.callerId);
      sql += ` AND caller_id = $${params.length}`;
    }

    params.push(q.limit);
    sql += ` ORDER BY at ASC, id ASC LIMIT $${params.length}`;

    const { rows } = await getSqlExecutor().query(sql, params);
    return rows.map(rowToEvent);
  }
}
