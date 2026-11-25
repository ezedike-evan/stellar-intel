import { timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';
import { rateLimitedResponse } from '@/lib/api/response';

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

/**
 * Throttle failed admin key authentication attempts per IP.
 * Only call when isAdminRequest() returns false.
 * Counts 1 failure in auth.admin.failed (max 10 requests per 15 minutes).
 */
export async function throttleFailedAdminAuth(request: Request): Promise<NextResponse | null> {
  const ip = getClientIp(request.headers);
  const rl = await checkRateLimit(ip, {
    bucket: 'auth.admin.failed',
    maxRequests: 10,
    windowMs: 15 * 60_000,
  });
  if (!rl.allowed) {
    return rateLimitedResponse(rl);
  }
  return null;
}
