import { NextResponse } from 'next/server';
import { tryGetReputationStore } from '@/lib/reputation/store';

// Shared "is there anywhere to write?" guard for the scheduled endpoints
// (publisher/tick, reputation/reconcile, reputation/refresh).
//
// Each of those reaches `getReputationStore()` — directly or through the shared
// pool — somewhere below its entry point. With no `DATABASE_URL`,
// `resolveBackend()` falls through to `postgres` in production and the pool
// raises `ReputationStoreUnavailableError`, which the logger wrapper then
// flattened into `{"code":"INTERNAL_ERROR"}` with a 500. That response says
// nothing about the cause, so the reputation cron ran red every five minutes
// for days while the log only ever showed "Internal server error".
//
// An unconfigured backend is a deployment state, not a fault, and it already
// has a name elsewhere: `/api/publisher/health` reports it as `durable: false`.
// This gives the write paths the matching signal so the cron can tell "nowhere
// to write yet" apart from "the write failed".

/**
 * Returns a NextResponse to short-circuit with when no durable reputation store
 * is configured (503 `STORE_UNAVAILABLE`), or null when one can be built.
 *
 * Only `ReputationStoreUnavailableError` degrades here — a bad
 * `REPUTATION_BACKEND` or a pool that fails for any other reason still
 * propagates and still reports as an error.
 */
export function checkDurableStore(): NextResponse | null {
  if (tryGetReputationStore()) return null;

  return NextResponse.json(
    {
      code: 'STORE_UNAVAILABLE',
      message: 'No durable reputation store is configured (DATABASE_URL is unset)',
      durable: false,
    },
    { status: 503 }
  );
}
