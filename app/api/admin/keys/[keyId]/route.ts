import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { isAdminRequest, throttleFailedAdminAuth } from '@/lib/auth/admin';
import { getApiKeyStore } from '@/lib/auth/key-store';
import type { ApiError } from '@/types';
import { enforceRateLimit } from '@/lib/api/response';

export const runtime = 'nodejs';

const KEY_ID_PATTERN = /^[0-9a-f]{16}$/;

// ─── DELETE /api/admin/keys/[keyId] ───────────────────────────────────────────
//
// Revokes a caller key immediately. Only ADMIN_SECRET_KEY authenticates this
// route: a caller key with the `admin` scope must not be able to mint or revoke
// keys, or a leaked one could make itself permanent.

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ keyId: string }> }
): Promise<NextResponse> {
  return withRequestLogger(request, 'api.admin.keys.revoke', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.admin.keys',
      maxRequests: 30,
    });
    if (limited) return limited;

    if (!isAdminRequest(request)) {
      const throttled = await throttleFailedAdminAuth(request);
      if (throttled) return throttled;
      return NextResponse.json<ApiError>(
        { code: 'FORBIDDEN', message: 'Admin key required' },
        { status: 403 }
      );
    }

    const { keyId } = await params;

    if (!KEY_ID_PATTERN.test(keyId)) {
      return NextResponse.json<ApiError>(
        { code: 'VALIDATION_ERROR', message: 'keyId must be 16 lowercase hex characters' },
        { status: 400 }
      );
    }

    const revoked = await getApiKeyStore().revoke(keyId, new Date().toISOString());

    if (!revoked) {
      return NextResponse.json<ApiError>(
        { code: 'NOT_FOUND', message: `Key ${keyId} not found or already revoked` },
        { status: 404 }
      );
    }

    logger.info({ event: 'api_key_revoked', keyId });
    return new NextResponse(null, { status: 204 });
  });
}
