import { randomUUID, randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import { isAdminRequest } from '@/lib/auth/admin';
import { CreateSubscriptionSchema } from '@/lib/webhooks/schema';
import { getWebhookStore } from '@/lib/webhooks/store';
import type { ApiError } from '@/types';
import { enforceRateLimit } from '@/lib/api/response';

export const runtime = 'nodejs';

// ─── POST /api/webhooks/subscriptions ─────────────────────────────────────────
//
// Creates a new webhook subscription. Returns the generated secret once —
// callers must store it immediately; it is never returned again.

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.webhooks.subscriptions.create', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.webhooks.subscriptions',
      maxRequests: 30,
    });
    if (limited) return limited;

    if (!isAdminRequest(request)) {
      return NextResponse.json<ApiError>(
        { code: 'FORBIDDEN', message: 'Admin key required' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = CreateSubscriptionSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn({ event: 'subscription_validation_failed' });
      return NextResponse.json<ApiError>(
        {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'Invalid subscription payload',
        },
        { status: 400 }
      );
    }

    const secret = randomBytes(32).toString('hex');
    const sub = {
      id: randomUUID(),
      url: parsed.data.url,
      secret,
      events: parsed.data.events,
      createdAt: new Date().toISOString(),
    };

    await getWebhookStore().saveSubscription(sub);
    logger.info({ event: 'subscription_created', id: sub.id, url: sub.url });

    return NextResponse.json(
      { id: sub.id, url: sub.url, events: sub.events, secret },
      { status: 201 }
    );
  });
}

// ─── GET /api/webhooks/subscriptions ──────────────────────────────────────────
//
// Lists all subscriptions. Secrets are omitted from the response.

export async function GET(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.webhooks.subscriptions.list', async (logger) => {
    if (!isAdminRequest(request)) {
      return NextResponse.json<ApiError>(
        { code: 'FORBIDDEN', message: 'Admin key required' },
        { status: 403 }
      );
    }

    const subs = await getWebhookStore().listSubscriptions();
    logger.info({ event: 'subscriptions_listed', count: subs.length });

    const redacted = subs.map(({ secret: _secret, ...rest }) => rest);
    return NextResponse.json(redacted);
  });
}
