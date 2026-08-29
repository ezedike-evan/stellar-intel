import { hasSharedBackend, incrementRateLimitCount, pruneRateLimitBuckets } from './shared-state';

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

// In-process fallback, used only when no shared backend is configured (local
// dev, tests). It is per-instance and therefore NOT a real limit on serverless
// — that was the whole of #911. See lib/api/shared-state.ts.
const store = new Map<string, RateLimitEntry>();

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 60;
/** Prune roughly once every this many checks, rather than on a timer. */
const PRUNE_EVERY = 500;

let checksSincePrune = 0;

export interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  bucket?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
  /** The configured request cap for this bucket's window. */
  limit: number;
  /** Epoch ms when the current window resets. */
  resetAt: number;
  /**
   * False when the count came from this instance's memory rather than shared
   * state, i.e. the limit is per-instance. Lets a caller reason about whether
   * the advertised `X-RateLimit-*` headers actually mean anything.
   */
  shared: boolean;
}

export function getClientIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? headers.get('x-real-ip') ?? 'unknown'
  );
}

function checkInProcess(
  key: string,
  windowMs: number,
  maxRequests: number,
  now: number
): RateLimitResult {
  const entry = store.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    store.set(key, { count: 1, windowStart: now });
    return {
      allowed: true,
      remaining: maxRequests - 1,
      retryAfter: 0,
      limit: maxRequests,
      resetAt: now + windowMs,
      shared: false,
    };
  }

  const resetAt = entry.windowStart + windowMs;

  if (entry.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil((resetAt - now) / 1000),
      limit: maxRequests,
      resetAt,
      shared: false,
    };
  }

  entry.count += 1;
  return {
    allowed: true,
    remaining: maxRequests - entry.count,
    retryAfter: 0,
    limit: maxRequests,
    resetAt,
    shared: false,
  };
}

/**
 * Counts one request against `ip` and reports whether it is allowed.
 *
 * Async because a correct limit has to be counted somewhere every instance can
 * see. Windows are fixed (`floor(now / windowMs)`) rather than sliding, so each
 * instance derives the same window key without coordinating.
 *
 * Falls back to per-instance counting if the shared backend errors — a limiter
 * outage should degrade the limit, not take the endpoint down with it.
 */
export async function checkRateLimit(
  ip: string,
  options: RateLimitOptions = {}
): Promise<RateLimitResult> {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const key = options.bucket ? `${options.bucket}:${ip}` : ip;
  const now = Date.now();

  if (!hasSharedBackend()) {
    return checkInProcess(key, windowMs, maxRequests, now);
  }

  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;

  let count: number | null = null;
  try {
    count = await incrementRateLimitCount(key, windowStart);

    checksSincePrune += 1;
    if (checksSincePrune >= PRUNE_EVERY) {
      checksSincePrune = 0;
      // Fire and forget: pruning is housekeeping, and awaiting it would put a
      // DELETE on the request path.
      void pruneRateLimitBuckets(windowStart - windowMs).catch(() => {});
    }
  } catch {
    count = null;
  }

  if (count === null) {
    return checkInProcess(key, windowMs, maxRequests, now);
  }

  if (count > maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil((resetAt - now) / 1000),
      limit: maxRequests,
      resetAt,
      shared: true,
    };
  }

  return {
    allowed: true,
    remaining: maxRequests - count,
    retryAfter: 0,
    limit: maxRequests,
    resetAt,
    shared: true,
  };
}

export function clearRateLimitStore(): void {
  store.clear();
  checksSincePrune = 0;
}
