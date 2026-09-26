import { getSqlExecutor, hasDatabaseUrl } from '@/lib/reputation/pool';

// ─── Cross-instance state for the limiter and the lock (Issue #911) ────────────
//
// Both the rate limiter and the refresh/publish lock were module-level `Map`s.
// On serverless that is per-instance: the effective rate limit was
// `configured × instance count`, and the lock's 409 guard was decorative
// because two warm instances held two independent locks.
//
// Backed by Postgres rather than a dedicated KV service because Postgres is
// what this deployment already has. That does mean one extra round trip on
// every rate-limited request; the alternative was continuing to advertise
// `X-RateLimit-*` headers describing a limit that does not limit.
//
// Falls back to in-process state when no database is configured, so local dev
// and tests keep working without one. The fallback is explicitly NOT correct
// across instances — it is a convenience, not a second implementation.

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    bucket_key   TEXT   NOT NULL,
    window_start BIGINT NOT NULL,
    count        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket_key, window_start)
  );

  CREATE TABLE IF NOT EXISTS advisory_locks (
    lock_key   TEXT   PRIMARY KEY,
    expires_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS idempotency_keys (
    idempotency_key TEXT   PRIMARY KEY,
    status          INTEGER NOT NULL,
    body            TEXT   NOT NULL,
    headers         TEXT   NOT NULL DEFAULT '{}',
    expires_at      BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS intent_nonces (
    public_key TEXT   NOT NULL,
    nonce      TEXT   NOT NULL,
    expires_at BIGINT NOT NULL,
    PRIMARY KEY (public_key, nonce)
  );
`;

let schemaReady: Promise<void> | null = null;

/**
 * Creates both tables once per process. Mirrors how the reputation drivers
 * bootstrap their schema — `lib/reputation/migrations/` is not applied by
 * anything, so inline DDL is the only mechanism that actually runs.
 */
async function ensureSchema(): Promise<void> {
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

export function hasSharedBackend(): boolean {
  return hasDatabaseUrl();
}

/** Test seam: forget that the schema was created. */
export function _resetSharedSchema(): void {
  schemaReady = null;
}

// ─── Rate limiting ─────────────────────────────────────────────────────────────

/**
 * Increments the counter for `key` in the window containing `now` and returns
 * the post-increment count.
 *
 * One atomic upsert, so concurrent instances cannot both read a stale count and
 * each decide they are under the limit. Requests over the cap still increment;
 * the count is bounded by the window, and not incrementing would let a client
 * sit exactly at the limit indefinitely.
 */
export async function incrementRateLimitCount(
  key: string,
  windowStart: number
): Promise<number | null> {
  if (!hasSharedBackend()) return null;

  await ensureSchema();
  const { rows } = await getSqlExecutor().query(
    `INSERT INTO rate_limit_buckets (bucket_key, window_start, count)
          VALUES ($1, $2, 1)
     ON CONFLICT (bucket_key, window_start)
     DO UPDATE SET count = rate_limit_buckets.count + 1
       RETURNING count`,
    [key, windowStart]
  );

  const count = rows[0]?.['count'];
  return count == null ? null : Number(count);
}

/** Drops windows that closed before `cutoff`. Safe to call opportunistically. */
export async function pruneRateLimitBuckets(cutoff: number): Promise<void> {
  if (!hasSharedBackend()) return;
  await ensureSchema();
  await getSqlExecutor().query(`DELETE FROM rate_limit_buckets WHERE window_start < $1`, [cutoff]);
}

// ─── Locking ───────────────────────────────────────────────────────────────────

/**
 * Takes `key` until `expiresAt`, returning false when someone else holds it.
 *
 * The `WHERE` clause on the conflict path is what makes this a lock rather than
 * a last-writer-wins upsert: an existing row is only overwritten once it has
 * expired, so a live holder is never displaced.
 */
export async function acquireSharedLock(
  key: string,
  expiresAt: number,
  now: number
): Promise<boolean | null> {
  if (!hasSharedBackend()) return null;

  await ensureSchema();
  const { rows } = await getSqlExecutor().query(
    `INSERT INTO advisory_locks (lock_key, expires_at)
          VALUES ($1, $2)
     ON CONFLICT (lock_key)
     DO UPDATE SET expires_at = $2
           WHERE advisory_locks.expires_at <= $3
       RETURNING lock_key`,
    [key, expiresAt, now]
  );

  return rows.length > 0;
}

export async function releaseSharedLock(key: string): Promise<void> {
  if (!hasSharedBackend()) return;
  await ensureSchema();
  await getSqlExecutor().query(`DELETE FROM advisory_locks WHERE lock_key = $1`, [key]);
}

export async function isSharedLockHeld(key: string, now: number): Promise<boolean | null> {
  if (!hasSharedBackend()) return null;
  await ensureSchema();
  const { rows } = await getSqlExecutor().query(
    `SELECT 1 FROM advisory_locks WHERE lock_key = $1 AND expires_at > $2`,
    [key, now]
  );
  return rows.length > 0;
}

// ─── Idempotency ───────────────────────────────────────────────────────────────

export interface SharedIdempotentRecord {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

/** Returns the stored response for `key`, or null when absent or expired. */
export async function getSharedIdempotent(
  key: string,
  now: number
): Promise<SharedIdempotentRecord | null | undefined> {
  if (!hasSharedBackend()) return undefined;

  await ensureSchema();
  const { rows } = await getSqlExecutor().query(
    `SELECT status, body, headers
       FROM idempotency_keys
      WHERE idempotency_key = $1 AND expires_at > $2`,
    [key, now]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    status: Number(row['status']),
    body: JSON.parse(String(row['body'])) as unknown,
    headers: JSON.parse(String(row['headers'] ?? '{}')) as Record<string, string>,
  };
}

/**
 * Stores a response under `key` until `expiresAt`.
 *
 * `DO NOTHING` on conflict, not `DO UPDATE`: the first response for a key is
 * the one every retry must replay. Overwriting would let a later, different
 * response leak out under a key a client believes is pinned.
 */
export async function storeSharedIdempotent(
  key: string,
  record: SharedIdempotentRecord,
  expiresAt: number
): Promise<boolean | undefined> {
  if (!hasSharedBackend()) return undefined;

  await ensureSchema();
  await getSqlExecutor().query(
    `INSERT INTO idempotency_keys (idempotency_key, status, body, headers, expires_at)
          VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [key, record.status, JSON.stringify(record.body), JSON.stringify(record.headers), expiresAt]
  );
  return true;
}

/** Drops keys whose TTL has passed. Safe to call opportunistically. */
export async function pruneSharedIdempotent(now: number): Promise<void> {
  if (!hasSharedBackend()) return;
  await ensureSchema();
  await getSqlExecutor().query(`DELETE FROM idempotency_keys WHERE expires_at <= $1`, [now]);
}

// ─── Intent replay nonces ──────────────────────────────────────────────────────

/**
 * Claims `nonce` for `publicKey` until `expiresAt`, returning false when it is
 * already held (a replay).
 *
 * Same expired-only overwrite as `acquireSharedLock`: a live nonce is never
 * reclaimed, but one whose deadline has passed can be, so the key space does
 * not fill up with dead rows between prunes.
 */
export async function claimSharedIntentNonce(
  publicKey: string,
  nonce: string,
  expiresAt: number,
  now: number
): Promise<boolean | null> {
  if (!hasSharedBackend()) return null;

  await ensureSchema();
  const { rows } = await getSqlExecutor().query(
    `INSERT INTO intent_nonces (public_key, nonce, expires_at)
          VALUES ($1, $2, $3)
     ON CONFLICT (public_key, nonce)
     DO UPDATE SET expires_at = $3
           WHERE intent_nonces.expires_at <= $4
       RETURNING nonce`,
    [publicKey, nonce, expiresAt, now]
  );

  return rows.length > 0;
}

/** Drops nonces whose deadline has passed. Safe to call opportunistically. */
export async function pruneSharedIntentNonces(now: number): Promise<void> {
  if (!hasSharedBackend()) return;
  await ensureSchema();
  await getSqlExecutor().query(`DELETE FROM intent_nonces WHERE expires_at <= $1`, [now]);
}
