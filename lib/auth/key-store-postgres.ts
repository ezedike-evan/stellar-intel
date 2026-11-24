import { getSqlExecutor } from '@/lib/reputation/pool';
import type { ApiScope } from './api-keys';
import type { ApiKeyRecord, ApiKeyStore, CallerTier } from './key-store';

// ─── Durable caller-key store ─────────────────────────────────────────────────
//
// The in-memory store is per-instance: on serverless a key issued on one
// instance would not exist on another, and it would vanish on cold start.
//
// The DDL is inline, run once by ensureSchema(), because nothing applies
// migrations/ files. Same approach as lib/webhooks/postgres.ts.

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS api_keys (
    key_id            TEXT        PRIMARY KEY,
    display_prefix    TEXT        NOT NULL,
    key_hash          TEXT        NOT NULL,
    name              TEXT        NOT NULL,
    scopes            TEXT        NOT NULL, -- JSON array of ApiScope strings
    tier              TEXT        NOT NULL CHECK (tier IN ('standard','partner')),
    max_intent_amount TEXT,
    created_at        TIMESTAMPTZ NOT NULL,
    expires_at        TIMESTAMPTZ,
    revoked_at        TIMESTAMPTZ,
    last_used_at      TIMESTAMPTZ
// ─── Durable caller API-key store (AGS002) ─────────────────────────────────────
//
// DDL is run inline because nothing applies migrations/ files. Same approach as
// lib/webhooks/postgres.ts.

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS api_keys (
    key_id             TEXT        PRIMARY KEY,
    display_prefix     TEXT        NOT NULL,
    key_hash           TEXT        NOT NULL,
    name               TEXT        NOT NULL,
    scopes             TEXT        NOT NULL, -- JSON array of ApiScope strings
    tier               TEXT        NOT NULL CHECK (tier IN ('standard', 'partner')),
    max_intent_amount  TEXT,
    created_at         TIMESTAMPTZ NOT NULL,
    expires_at         TIMESTAMPTZ,
    revoked_at         TIMESTAMPTZ,
    last_used_at       TIMESTAMPTZ
  );

  CREATE INDEX IF NOT EXISTS idx_api_keys_created_at
    ON api_keys (created_at DESC);
`;

let schemaReady: Promise<void> | null = null;

/** Creates the table once per process. */
const COLUMNS = `key_id, display_prefix, key_hash, name, scopes, tier, max_intent_amount,
                created_at, expires_at, revoked_at, last_used_at`;

let schemaReady: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = getSqlExecutor()
      .query(SCHEMA_SQL)
      .then(() => undefined)
      .catch((err: unknown) => {
        // Reset so a transient failure does not permanently poison the process.
        schemaReady = null;
        throw err;
      });
  }
  return schemaReady;
}

/** Test seam: forget that the schema was created. */
export function _resetApiKeySchema(): void {
  schemaReady = null;
}

// pg returns TIMESTAMPTZ columns as Date objects; the types promise ISO strings.
function toIso(value: unknown): string {
  return new Date(value as string).toISOString();
}

function nullableIso(value: unknown): string | null {
function toIsoOrNull(value: unknown): string | null {
  return value == null ? null : toIso(value);
}

function rowToRecord(r: Record<string, unknown>): ApiKeyRecord {
  return {
    keyId: r['key_id'] as string,
    displayPrefix: r['display_prefix'] as string,
    hash: r['key_hash'] as string,
    name: r['name'] as string,
    scopes: JSON.parse(r['scopes'] as string) as ApiScope[],
    tier: r['tier'] as CallerTier,
    maxIntentAmount: (r['max_intent_amount'] as string | null) ?? null,
    createdAt: toIso(r['created_at']),
    expiresAt: nullableIso(r['expires_at']),
    revokedAt: nullableIso(r['revoked_at']),
    lastUsedAt: nullableIso(r['last_used_at']),
  };
}

const SELECT_COLUMNS = `key_id, display_prefix, key_hash, name, scopes, tier,
                        max_intent_amount, created_at, expires_at, revoked_at, last_used_at`;

    expiresAt: toIsoOrNull(r['expires_at']),
    revokedAt: toIsoOrNull(r['revoked_at']),
    lastUsedAt: toIsoOrNull(r['last_used_at']),
  };
}

export class PostgresApiKeyStore implements ApiKeyStore {
  async create(record: ApiKeyRecord): Promise<void> {
    await ensureSchema();
    // Never upsert: a key's hash must never be silently replaced.
    const { rows } = await getSqlExecutor().query(
      `INSERT INTO api_keys (
         key_id, display_prefix, key_hash, name, scopes, tier,
         max_intent_amount, created_at, expires_at, revoked_at, last_used_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `INSERT INTO api_keys (${COLUMNS})
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (key_id) DO NOTHING
       RETURNING key_id`,
      [
        record.keyId,
        record.displayPrefix,
        record.hash,
        record.name,
        JSON.stringify(record.scopes),
        record.tier,
        record.maxIntentAmount,
        record.createdAt,
        record.expiresAt,
        record.revokedAt,
        record.lastUsedAt,
      ]
    );
    if (rows.length === 0) throw new Error('api key already exists');
  }

  async get(keyId: string): Promise<ApiKeyRecord | null> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      `SELECT ${SELECT_COLUMNS} FROM api_keys WHERE key_id = $1`,
      `SELECT ${COLUMNS} FROM api_keys WHERE key_id = $1`,
      [keyId]
    );
    const row = rows[0];
    return row ? rowToRecord(row) : null;
  }

  async list(): Promise<ApiKeyRecord[]> {
    await ensureSchema();
    const { rows } = await getSqlExecutor().query(
      `SELECT ${SELECT_COLUMNS} FROM api_keys ORDER BY created_at DESC`
      `SELECT ${COLUMNS} FROM api_keys ORDER BY created_at DESC`
    );
    return rows.map(rowToRecord);
  }

  async revoke(keyId: string, at: string): Promise<boolean> {
    await ensureSchema();
    // RETURNING rather than rowCount: SqlExecutor only exposes `rows`.
    const { rows } = await getSqlExecutor().query(
      `UPDATE api_keys SET revoked_at = $2
        WHERE key_id = $1 AND revoked_at IS NULL
        RETURNING key_id`,
    const { rows } = await getSqlExecutor().query(
      `UPDATE api_keys SET revoked_at = $2 WHERE key_id = $1 AND revoked_at IS NULL RETURNING key_id`,
      [keyId, at]
    );
    return rows.length > 0;
  }

  async touch(keyId: string, at: string): Promise<void> {
    await ensureSchema();
    await getSqlExecutor().query(`UPDATE api_keys SET last_used_at = $2 WHERE key_id = $1`, [
      keyId,
      at,
    ]);
  }
}
