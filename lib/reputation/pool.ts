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
 * Lazily builds the process-wide pool. Throws a directed error rather than
 * `pg`'s generic connection failure when `DATABASE_URL` is absent, because a
 * missing URL here means the whole durable-reputation path is misconfigured.
 */
export function getPool(): Pool {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
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
