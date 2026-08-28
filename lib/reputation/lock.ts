import {
  acquireSharedLock,
  hasSharedBackend,
  isSharedLockHeld,
  releaseSharedLock,
} from '@/lib/api/shared-state';

interface LockEntry {
  lockedAt: number;
  expiresAt: number;
}

// In-process fallback for local dev and tests. On serverless this is
// per-instance, so two warm instances each acquire "the" lock and the 409 guard
// on /api/reputation/refresh and /api/publisher/tick does nothing — see #911.
const locks = new Map<string, LockEntry>();
const DEFAULT_TTL_MS = 60_000;

function acquireInProcess(key: string, ttlMs: number, now: number): boolean {
  const existing = locks.get(key);
  if (existing && now < existing.expiresAt) {
    return false;
  }
  locks.set(key, { lockedAt: now, expiresAt: now + ttlMs });
  return true;
}

/**
 * Takes `key` for `ttlMs`, returning false when another holder has it.
 *
 * Async because mutual exclusion across serverless instances requires shared
 * state. Falls back to the in-process map when no backend is configured, or
 * when the shared one errors — a locking outage should not take the endpoint
 * down, though it does temporarily weaken the guarantee.
 */
export async function acquireLock(key: string, ttlMs = DEFAULT_TTL_MS): Promise<boolean> {
  const now = Date.now();

  if (!hasSharedBackend()) {
    return acquireInProcess(key, ttlMs, now);
  }

  try {
    const acquired = await acquireSharedLock(key, now + ttlMs, now);
    if (acquired !== null) return acquired;
  } catch {
    // fall through to the in-process guard
  }

  return acquireInProcess(key, ttlMs, now);
}

export async function releaseLock(key: string): Promise<void> {
  locks.delete(key);
  if (!hasSharedBackend()) return;
  try {
    await releaseSharedLock(key);
  } catch {
    // A failed release is self-healing: the row carries a TTL, so the lock
    // frees itself rather than wedging the endpoint until someone intervenes.
  }
}

export async function isLocked(key: string): Promise<boolean> {
  const now = Date.now();

  if (hasSharedBackend()) {
    try {
      const held = await isSharedLockHeld(key, now);
      if (held !== null) return held;
    } catch {
      // fall through to the in-process map
    }
  }

  const entry = locks.get(key);
  if (!entry) return false;
  if (now >= entry.expiresAt) {
    locks.delete(key);
    return false;
  }
  return true;
}

/** Clears expired entries from the in-process map. Shared rows expire by TTL. */
export function cleanExpiredLocks(): void {
  const now = Date.now();
  for (const [key, entry] of locks.entries()) {
    if (now >= entry.expiresAt) locks.delete(key);
  }
}
