import type { NextRequest } from 'next/server';

export function isAdminRequest(request: NextRequest): boolean {
  const key = request.headers.get('x-admin-key');
  const secret = process.env.ADMIN_SECRET_KEY;
  if (!secret) return false;
  return key === secret;
}
