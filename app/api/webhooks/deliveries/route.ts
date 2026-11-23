import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withRequestLogger } from '@/lib/logger';
import { isAdminRequest } from '@/lib/auth/admin';
import { getWebhookStore } from '@/lib/webhooks/store';
import type { ApiError } from '@/types';
import { enforceRateLimit } from '@/lib/api/response';

export const runtime = 'nodejs';

const DeliveryQuerySchema = z.object({
  status: z.enum(['success', 'failed', 'dead_letter']).optional(),
  subscriptionId: z.string().min(1).max(100).optional(),
  eventId: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

// ─── GET /api/webhooks/deliveries ─────────────────────────────────────────────
//
// Returns webhook delivery records, newest first, filtered by status,
// subscription, or event with an optional limit.

export async function GET(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.webhooks.deliveries.list', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.webhooks.deliveries',
      maxRequests: 30,
    });
    if (limited) return limited;

    if (!isAdminRequest(request)) {
      return NextResponse.json<ApiError>(
        { code: 'FORBIDDEN', message: 'Admin key required' },
        { status: 403 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const raw: Record<string, string> = {};
    const status = searchParams.get('status');
    if (status !== null) raw.status = status;
    const subscriptionId = searchParams.get('subscriptionId');
    if (subscriptionId !== null) raw.subscriptionId = subscriptionId;
    const eventId = searchParams.get('eventId');
    if (eventId !== null) raw.eventId = eventId;
    const limit = searchParams.get('limit');
    if (limit !== null) raw.limit = limit;

    const parsed = DeliveryQuerySchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn({ event: 'delivery_query_validation_failed', issues: parsed.error.issues });
      return NextResponse.json<ApiError>(
        {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'Invalid query parameters',
        },
        { status: 400 }
      );
    }

    const deliveries = await getWebhookStore().listDeliveries(parsed.data);
    logger.info({ event: 'deliveries_listed', count: deliveries.length });
    return NextResponse.json(deliveries);
  });
}
