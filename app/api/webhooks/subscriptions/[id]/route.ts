import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { isAdminRequest } from '@/lib/auth/admin';
import { getWebhookStore } from '@/lib/webhooks/store';
import type { ApiError } from '@/types';
import { enforceRateLimit } from '@/lib/api/response';

export const runtime = 'nodejs';

// ─── DELETE /api/webhooks/subscriptions/[id] ──────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  return withRequestLogger(request, 'api.webhooks.subscriptions.delete', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.webhooks.subscription',
      maxRequests: 30,
    });
    if (limited) return limited;

    if (!isAdminRequest(request)) {
      return NextResponse.json<ApiError>(
        { code: 'FORBIDDEN', message: 'Admin key required' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const deleted = await getWebhookStore().deleteSubscription(id);

    if (!deleted) {
      return NextResponse.json<ApiError>(
        { code: 'NOT_FOUND', message: `Subscription ${id} not found` },
        { status: 404 }
      );
    }

    logger.info({ event: 'subscription_deleted', id });
    return new NextResponse(null, { status: 204 });
  });
}
