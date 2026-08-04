import { Pool } from 'pg';
import type { SqlExecutor } from './postgres';

// ─── Shared Postgres pool (Issue #906) ─────────────────────────────────────────
//
// `createReputationStore({ backend: 'postgres' })` needs a `SqlExecutor`, and
// before this module existed nothing supplied one: `getReputationStore()` called
// the factory with no options, so the postgres branch threw on every call in
// production and the probe sweep never wrote a row. Every caller that needs a
// durable store now gets its executor from here.
//
// The pool is a module-level singleton so a warm Fluid Compute instance reuses
// connections across invocations instead of opening one per request.

let pool: Pool | null = null;

/**
 * Raised when a durable store cannot be built at all — as opposed to a query
 * that failed against a working one.
 *
 * It is a named type rather than a bare `Error` because callers legitimately
 * degrade on it: `next build` prerenders pages with `NODE_ENV=production` and
 * no `DATABASE_URL`, which is a real, expected configuration, not a fault. Two
 * call sites used to detect that case by string-matching the old message, which
 * broke the moment the message changed.
 */
export class ReputationStoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReputationStoreUnavailableError';
  }
}

/**
 * Lazily builds the process-wide pool. Raises
 * `ReputationStoreUnavailableError` rather than `pg`'s generic connection
 * failure when `DATABASE_URL` is absent, because a missing URL here means the
 * whole durable-reputation path is unconfigured.
 */
export function getPool(): Pool {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new ReputationStoreUnavailableError(
        'DATABASE_URL is required for the postgres reputation backend. ' +
          'Set it, or set REPUTATION_BACKEND=sqlite|memory for a non-durable backend.'
      );
    }
    pool = new Pool({ connectionString: databaseUrl });
  }
  return pool;
}

/** A `SqlExecutor` view of the shared pool. */
export function getSqlExecutor(): SqlExecutor {
  return getPool();
}

/** True when a durable postgres backend can actually be constructed. */
export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** Test seam: drops the cached pool so the next call rebuilds it. */
export async function _resetPool(): Promise<void> {
  const active = pool;
  pool = null;
  if (active) await active.end();
}
