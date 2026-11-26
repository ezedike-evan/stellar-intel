import type { NextRequest, NextResponse } from 'next/server';
import { withV1 } from '@/lib/api/v1';
import { getDailyQuota, QUOTA_BUCKET, QUOTA_WINDOW_MS } from '@/lib/api/quota';
import { peekRateLimitUsage } from '@/lib/api/rate-limit';

export const runtime = 'nodejs';

/**
 * GET /api/v1/usage — let a caller see its own tier, scopes, quota and windows
 * (AGS025, issue #2218).
 *
 * An agent should be able to ask how much budget it has left before starting
 * a batch, rather than discovering limits by hitting 429s. The read never
 * spends quota on the counted buckets: windows and quota come from peek
 * helpers that do not increment anything. The response never contains the IP.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return withV1(
    request,
    {
      bucket: 'v1.usage',
      maxRequests: 30,
      // Any caller may read its own usage.
      scope: null,
    },
    async (ctx) => {
      const { caller } = ctx;
      const keyPrefix = caller.keyId ? `sik_${caller.keyId}` : null;

      // Windows are read by the caller's rate-limit key: withV1 rate-limits
      // a signed-in caller by its key, and only anonymous callers by IP.
      // For anonymous callers the key is the IP, so they keep working.
      const windows = (await peekRateLimitUsage(caller.rateLimitKey)).map((entry) => ({
        bucket: entry.bucket,
        used: entry.used,
        resetAt: new Date(entry.resetAt).toISOString(),
      }));

      const quotaLimit = getDailyQuota(caller.tier);
      let quota: { limit: number; used: number; resetAt: string } | null = null;
      if (quotaLimit !== null) {
        const quotaUsage = (await peekRateLimitUsage(caller.rateLimitKey, QUOTA_WINDOW_MS)).find(
          (entry) => entry.bucket === QUOTA_BUCKET
        );
        quota = {
          limit: quotaLimit,
          used: quotaUsage?.used ?? 0,
          resetAt: new Date(quotaUsage?.resetAt ?? startOfNextUtcDay(Date.now())).toISOString(),
        };
      }

      return {
        status: 200,
        body: {
          caller: {
            kind: caller.kind,
            keyPrefix,
            tier: caller.tier,
            scopes: caller.scopes,
          },
          quota,
          windows,
        },
      };
    }
  );
}

/** UTC midnight starting the next day — the reset of a daily window with no usage yet. */
function startOfNextUtcDay(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}
