import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { isAdminRequest, throttleFailedAdminAuth } from '@/lib/auth/admin';
import { deliverToSubscription } from '@/lib/webhooks/dispatch';
import { getWebhookStore } from '@/lib/webhooks/store';
import type { ApiError } from '@/types';
import { enforceRateLimit } from '@/lib/api/response';

export const runtime = 'nodejs';
// The delivery is awaited, and it can take five attempts of up to 10 s each with 15 s of
// backoff between them. A shorter platform default could end the function before the new
// delivery record is written.
export const maxDuration = 90;

// ─── POST /api/webhooks/deliveries/[id]/redeliver (#2185, WHK007) ────────────
//
// Resends one logged delivery to its subscription, for an operator to use once a subscriber
// has fixed an outage. The stored envelope goes out unchanged, so the consumer sees the event
// id and idempotency key it saw, or missed, the first time and can de-duplicate on them.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  return withRequestLogger(request, 'api.webhooks.deliveries.redeliver', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.webhooks.redeliver',
      maxRequests: 10,
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

    const { id } = await params;
    const store = getWebhookStore();

    const delivery = await store.getDelivery(id);
    if (!delivery) {
      return NextResponse.json<ApiError>(
        { code: 'NOT_FOUND', message: `Delivery ${id} not found` },
        { status: 404 }
      );
    }

    const event = await store.getEvent(delivery.eventId);
    if (!event) {
      return NextResponse.json<ApiError>(
        {
          code: 'EVENT_NOT_RETAINED',
          message: `Event ${delivery.eventId} is not in the event store, so it cannot be resent`,
        },
        { status: 410 }
      );
    }

    const sub = await store.getSubscription(delivery.subscriptionId);
    if (!sub) {
      return NextResponse.json<ApiError>(
        {
          code: 'SUBSCRIPTION_DELETED',
          message: `Subscription ${delivery.subscriptionId} no longer exists`,
        },
        { status: 410 }
      );
    }

    if (!sub.events.includes(event.kind)) {
      return NextResponse.json<ApiError>(
        {
          code: 'EVENT_KIND_UNSUBSCRIBED',
          message: `Subscription ${sub.id} no longer subscribes to ${event.kind}`,
        },
        { status: 409 }
      );
    }

    // Straight to the subscription, not through dispatchEvent: that records the event first
    // and drops any whose idempotency key it has already seen, which this one always is.
    await deliverToSubscription(sub, event, store);

    logger.info({
      event: 'delivery_redelivered',
      deliveryId: id,
      eventId: event.id,
      subscriptionId: sub.id,
    });
    return NextResponse.json(
      { redelivered: true, eventId: event.id, subscriptionId: sub.id },
      { status: 202 }
    );
  });
}
