import { timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';

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
