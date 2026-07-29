/**
 * lib/api/idempotency.ts
 *
 * In-memory idempotency-key store for the public v1 API (#805): a client
 * that retries a POST with the same `Idempotency-Key` header gets back the
 * exact response the original request produced, instead of re-executing
 * the request (e.g. building a second, different unsigned transaction for
 * the same intent).
 *
 * Same storage model as lib/api/rate-limit.ts: an in-memory Map, per
 * process. That means it does not survive a process restart and is not
 * shared across serverless instances/regions -- acceptable for a single
 * long-lived server, but a production deployment that scales horizontally
 * needs a shared store (Redis, a database table) behind this same
 * interface. Documented here rather than silently assumed.
 */

export interface StoredIdempotentResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  storedAt: number;
}

const store = new Map<string, StoredIdempotentResponse>();

/** How long a stored response is replayed before the key can be reused. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export function getIdempotentResponse(key: string): StoredIdempotentResponse | null {
  const entry = store.get(key);
  if (!entry) return null;

  if (Date.now() - entry.storedAt > IDEMPOTENCY_TTL_MS) {
    store.delete(key);
    return null;
  }

  return entry;
}

export function storeIdempotentResponse(
  key: string,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  store.set(key, { status, body, headers, storedAt: Date.now() });
}

export function clearIdempotencyStore(): void {
  store.clear();
}
