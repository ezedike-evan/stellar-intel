interface LockEntry {
  lockedAt: number;
  expiresAt: number;
}

const locks = new Map<string, LockEntry>();
const DEFAULT_TTL_MS = 60_000;

export function acquireLock(key: string, ttlMs = DEFAULT_TTL_MS): boolean {
  const now = Date.now();
  const existing = locks.get(key);
  if (existing && now < existing.expiresAt) {
    return false;
  }
  locks.set(key, { lockedAt: now, expiresAt: now + ttlMs });
  return true;
}

export function releaseLock(key: string): void {
  locks.delete(key);
}

export function isLocked(key: string): boolean {
  const entry = locks.get(key);
  if (!entry) return false;
  if (Date.now() >= entry.expiresAt) {
    locks.delete(key);
    return false;
  }
  return true;
}

export function cleanExpiredLocks(): void {
  const now = Date.now();
  for (const [key, entry] of locks.entries()) {
    if (now >= entry.expiresAt) locks.delete(key);
  }
}
