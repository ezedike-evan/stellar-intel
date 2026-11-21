import { timingSafeEqual } from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';
import { rateLimitedResponse } from '@/lib/api/response';

/**
 * Throttles wrong guesses at `ADMIN_SECRET_KEY`, without spending the real
 * admin's request budget: only failures are counted. Call this *after*
 * `isAdminRequest()` returned false. Returns a ready 429 when the caller has
 * exhausted its failure budget, otherwise null.
 */
export async function throttleFailedAdminAuth(request: Request): Promise<NextResponse | null> {
  const rl = await checkRateLimit(getClientIp(request.headers), {
    bucket: 'auth.admin.failed',
    maxRequests: 10,
    windowMs: 15 * 60_000,
  });
  return rl.allowed ? null : rateLimitedResponse(rl);
}

export function isAdminRequest(request: NextRequest): boolean {
  const key = request.headers.get('x-admin-key');
  const secret = process.env.ADMIN_SECRET_KEY;
  if (!secret || !key) return false;
  try {
    return timingSafeEqual(Buffer.from(key), Buffer.from(secret));
  } catch {
    // timingSafeEqual throws when buffers have different lengths
    return false;
  }
}
