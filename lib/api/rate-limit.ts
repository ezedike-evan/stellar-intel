import {
  getRateLimitCounts,
  hasSharedBackend,
  incrementRateLimitCount,
  pruneRateLimitBuckets,
} from './shared-state';
// quota.ts imports checkRateLimit from here, so this is a cycle; it is safe
// because both sides only use the other's bindings inside function bodies,
// never at module-evaluation time.
import { QUOTA_BUCKET, QUOTA_WINDOW_MS } from './quota';
import { getLogger } from '@/lib/logger';

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

// The in-process path makes the effective limit `limit x instance count`, and
// nothing said so. These keep the warnings to one per process (no backend) and
// one per minute (backend errors), so a hot route cannot flood the log.
const BACKEND_ERROR_WARN_INTERVAL_MS = 60_000;
let warnedNoSharedBackend = false;
let lastBackendErrorWarnAt = 0;

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
  /** Length of the rate-limit window in milliseconds. */
  windowMs: number;
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
      windowMs,
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
      windowMs,
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
    windowMs,
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
    // Only production is worth a warning: local dev and tests have no database.
    if (process.env.NODE_ENV === 'production' && !warnedNoSharedBackend) {
      warnedNoSharedBackend = true;
      getLogger('api.rate-limit').warn({ event: 'rate_limit_no_shared_backend' });
    }
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
  } catch (err) {
    count = null;
    if (now - lastBackendErrorWarnAt >= BACKEND_ERROR_WARN_INTERVAL_MS) {
      lastBackendErrorWarnAt = now;
      getLogger('api.rate-limit').warn({
        event: 'rate_limit_shared_backend_error',
        error: String(err),
      });
    }
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
      windowMs,
      shared: true,
    };
  }

  return {
    allowed: true,
    remaining: maxRequests - count,
    retryAfter: 0,
    limit: maxRequests,
    resetAt,
    windowMs,
    shared: true,
  };
}

/**
 * Reads a caller's current-window usage without incrementing anything, so a
 * caller can ask how much budget it has left instead of discovering limits by
 * hitting 429s (AGS025).
 *
 * With a shared backend it reads the current window from `rate_limit_buckets`;
 * otherwise it scans the in-process `store` for live entries. The bucket name
 * is the key with the `:<rateLimitKey>` suffix stripped. The daily-quota
 * bucket is excluded from the per-minute windows — quota is reported
 * separately, not as a window — and is only returned when the requested
 * window is the daily quota window itself.
 *
 * Falls back to the in-process scan if the shared read errors — a limiter
 * outage should degrade the answer, not take the endpoint down with it.
 */
export async function peekRateLimitUsage(
  rateLimitKey: string,
  windowMs: number = 60_000
): Promise<Array<{ bucket: string; used: number; resetAt: number }>> {
  const now = Date.now();
  const suffix = `:${rateLimitKey}`;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;
  // The quota bucket is only a window when the caller asked for the daily
  // quota window itself (the usage route reads quota that way); in the
  // per-minute windows it would double-report the quota.
  const includeQuotaBucket = windowMs === QUOTA_WINDOW_MS;

  if (hasSharedBackend()) {
    try {
      const rows = await getRateLimitCounts(rateLimitKey, windowStart);
      if (rows !== null) {
        return rows
          .filter((row) => {
            const bucket = row.bucketKey.slice(0, -suffix.length);
            return includeQuotaBucket || bucket !== QUOTA_BUCKET;
          })
          .map((row) => ({
            bucket: row.bucketKey.slice(0, -suffix.length),
            used: row.count,
            resetAt,
          }));
      }
    } catch (err) {
      if (now - lastBackendErrorWarnAt >= BACKEND_ERROR_WARN_INTERVAL_MS) {
        lastBackendErrorWarnAt = now;
        getLogger('api.rate-limit').warn({
          event: 'rate_limit_shared_backend_error',
          error: String(err),
        });
      }
    }
  }

  const usage: Array<{ bucket: string; used: number; resetAt: number }> = [];
  for (const [key, entry] of store) {
    if (!key.endsWith(suffix)) continue;
    // A window the caller has not touched since it closed is not live usage.
    if (now - entry.windowStart >= windowMs) continue;
    const bucket = key.slice(0, -suffix.length);
    if (!includeQuotaBucket && bucket === QUOTA_BUCKET) continue;
    usage.push({ bucket, used: entry.count, resetAt: entry.windowStart + windowMs });
  }
  return usage;
}

export function clearRateLimitStore(): void {
  store.clear();
  checksSincePrune = 0;
  warnedNoSharedBackend = false;
  lastBackendErrorWarnAt = 0;
}
