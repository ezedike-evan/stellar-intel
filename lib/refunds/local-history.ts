/**
 * lib/refunds/local-history.ts
 *
 * The intents this browser started, remembered so the history page can ask the
 * refund lookup route about each one (#2123).
 *
 * There is deliberately no server-side history by account: it would publicly link
 * a wallet to its transfers. So the list lives here, in this browser only, and
 * holds no signature and no public key — just enough to look a refund up.
 *
 * Client-only. Every storage access is wrapped in try/catch and the module is safe
 * to import during SSR, where `window` is undefined.
 */

export const TRACKED_INTENTS_KEY = 'stellar-intel:tracked-intents';
export const TRACKED_INTENTS_MAX = 50;

export interface TrackedIntent {
  intentHash: string;
  anchorId: string;
  corridor: string;
  direction: 'withdraw' | 'deposit';
  transactionId: string;
  startedAt: string;
}

function isTrackedIntent(value: unknown): value is TrackedIntent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.intentHash === 'string' &&
    v.intentHash.length > 0 &&
    typeof v.anchorId === 'string' &&
    typeof v.corridor === 'string' &&
    (v.direction === 'withdraw' || v.direction === 'deposit') &&
    typeof v.transactionId === 'string' &&
    typeof v.startedAt === 'string'
  );
}

/** Copies only the known fields, so nothing extra (a signature, a key) is ever stored. */
function pick(entry: TrackedIntent): TrackedIntent {
  return {
    intentHash: entry.intentHash,
    anchorId: entry.anchorId,
    corridor: entry.corridor,
    direction: entry.direction,
    transactionId: entry.transactionId,
    startedAt: entry.startedAt,
  };
}

function startedAtMs(entry: TrackedIntent): number {
  const ms = Date.parse(entry.startedAt);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Every remembered intent, newest first. Corrupt storage or a malformed entry is dropped. */
export function listTrackedIntents(): TrackedIntent[] {
  if (typeof window === 'undefined') return [];

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(TRACKED_INTENTS_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(isTrackedIntent)
    .map(pick)
    .sort((a, b) => startedAtMs(b) - startedAtMs(a));
}

/**
 * Remembers an intent. An entry with the same intentHash is replaced (newest wins),
 * and only the newest TRACKED_INTENTS_MAX are kept. Best effort: a storage failure
 * never throws into the caller.
 */
export function rememberTrackedIntent(entry: TrackedIntent): void {
  if (typeof window === 'undefined' || !isTrackedIntent(entry)) return;

  const next = [
    pick(entry),
    ...listTrackedIntents().filter((e) => e.intentHash !== entry.intentHash),
  ]
    .sort((a, b) => startedAtMs(b) - startedAtMs(a))
    .slice(0, TRACKED_INTENTS_MAX);

  try {
    window.localStorage.setItem(TRACKED_INTENTS_KEY, JSON.stringify(next));
  } catch {
    // Private browsing, quota or storage disabled: the transfer proceeds, it just
    // isn't listed on the history page.
  }
}
