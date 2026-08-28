/**
 * lib/api/idempotency.ts
 *
 * The single idempotency-key store for the public API: a client that retries a
 * POST with the same `Idempotency-Key` gets back the exact response the original
 * request produced, instead of re-executing it (e.g. building a second,
 * different unsigned transaction for the same intent).
 *
 * There used to be two of these — this one and a private `Map` inside
 * `lib/api/v1.ts` — so whether a retry replayed depended on which wrapper the
 * route happened to use (#914). `v1.ts` now delegates here.
 *
 * Backed by shared state when a database is configured, falling back to an
 * in-process Map otherwise. The fallback is not correct across serverless
 * instances: a retry landing on a different instance re-executes. That was
 * previously the only behaviour; it is now the degraded one.
 */

import {
  getSharedIdempotent,
  hasSharedBackend,
  pruneSharedIdempotent,
  storeSharedIdempotent,
} from './shared-state';

export interface StoredIdempotentResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  storedAt: number;
}

const store = new Map<string, StoredIdempotentResponse>();

/** How long a stored response is replayed before the key can be reused. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Prune roughly once every this many stores, rather than on a timer. */
const PRUNE_EVERY = 200;
let storesSincePrune = 0;

/** The client-supplied key, trimmed, or null when absent or blank. */
export function readIdempotencyKey(headers: Headers): string | null {
  const key = headers.get('Idempotency-Key');
  return key && key.trim() ? key.trim() : null;
}

export async function getIdempotentResponse(key: string): Promise<StoredIdempotentResponse | null> {
  const now = Date.now();

  if (hasSharedBackend()) {
    try {
      const shared = await getSharedIdempotent(key, now);
      if (shared !== undefined) {
        return shared === null ? null : { ...shared, storedAt: now };
      }
    } catch {
      // fall through to the in-process map
    }
  }

  const entry = store.get(key);
  if (!entry) return null;

  if (now - entry.storedAt > IDEMPOTENCY_TTL_MS) {
    store.delete(key);
    return null;
  }

  return entry;
}

export async function storeIdempotentResponse(
  key: string,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<void> {
  const now = Date.now();
  store.set(key, { status, body, headers, storedAt: now });

  if (!hasSharedBackend()) return;

  try {
    await storeSharedIdempotent(key, { status, body, headers }, now + IDEMPOTENCY_TTL_MS);

    storesSincePrune += 1;
    if (storesSincePrune >= PRUNE_EVERY) {
      storesSincePrune = 0;
      void pruneSharedIdempotent(now).catch(() => {});
    }
  } catch {
    // The in-process copy above still covers same-instance retries.
  }
}

export function clearIdempotencyStore(): void {
  store.clear();
  storesSincePrune = 0;
}
