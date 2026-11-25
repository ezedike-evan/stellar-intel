import { checkRateLimit, type RateLimitResult } from './rate-limit';
import type { Caller, CallerTierName } from '@/lib/auth/caller';

/**
 * Daily request quotas per caller tier (AGS024, issue #2217).
 *
 * Per-minute limits stop bursts but not an agent stuck in a loop all day.
 * Keyed callers get a daily quota for their tier, counted once across all
 * three surfaces (REST v1, MCP, GraphQL): the bucket and key are shared, so
 * the quota is per caller, not per surface. One HTTP request counts as one
 * unit on every surface.
 *
 * Windows: with the shared backend they align to UTC midnight (the fixed
 * windows in `checkRateLimit` are `floor(now / windowMs)`, and a day-sized
 * window from the epoch lands on UTC midnight). The in-process fallback starts
 * its window at the first request instead — it is per-instance, like every
 * other in-process limit.
 */

export const DEFAULT_DAILY_QUOTA: Record<CallerTierName, number | null> = {
  anonymous: null,
  standard: 50_000,
  partner: 500_000,
};

export const QUOTA_BUCKET = 'quota.daily';
export const QUOTA_WINDOW_MS = 86_400_000;

let dailyQuotaOverrides: Partial<Record<CallerTierName, number | null>> | null = null;

/** Test seam: override the daily quota per tier (null restores the defaults). */
export function _setDailyQuotas(
  overrides: Partial<Record<CallerTierName, number | null>> | null
): void {
  dailyQuotaOverrides = overrides;
}

/** The effective daily quota for a tier, honouring the test seam. */
export function getDailyQuota(tier: CallerTierName): number | null {
  if (dailyQuotaOverrides && tier in dailyQuotaOverrides) {
    return dailyQuotaOverrides[tier] ?? null;
  }
  return DEFAULT_DAILY_QUOTA[tier];
}

/**
 * Counts one request against the caller's daily quota. Returns null when the
 * tier has no quota (anonymous: per-IP and already per-minute limited).
 */
export async function checkDailyQuota(caller: Caller): Promise<RateLimitResult | null> {
  const quota = getDailyQuota(caller.tier);
  if (quota === null) return null;
  return checkRateLimit(caller.rateLimitKey, {
    bucket: QUOTA_BUCKET,
    windowMs: QUOTA_WINDOW_MS,
    maxRequests: quota,
  });
}

export function quotaHeaders(rl: RateLimitResult): Record<string, string> {
  return {
    'X-Quota-Limit': String(rl.limit),
    'X-Quota-Remaining': String(Math.max(0, rl.remaining)),
    'X-Quota-Reset': String(Math.ceil(rl.resetAt / 1000)),
  };
}
