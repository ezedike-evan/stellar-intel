import { timingSafeEqual } from 'crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';
import { rateLimitedResponse } from '@/lib/api/response';

export function isAdminRequest(request: NextRequest | Request): boolean {
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

export async function throttleFailedAdminAuth(request: Request): Promise<NextResponse | null> {
  const rl = await checkRateLimit(getClientIp(request.headers), {
    bucket: 'auth.admin.failed',
    maxRequests: 10,
    windowMs: 15 * 60_000,
  });
  if (!rl.allowed) {
    return rateLimitedResponse(rl);
  }
  return null;
}
