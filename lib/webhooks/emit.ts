import { after } from 'next/server';
import { getLogger } from '@/lib/logger';
import { dispatchEvent } from './dispatch';
import { makeWebhookEvent } from './events';
import { getWebhookStore } from './store';
import type { WebhookEventKind } from './types';

const logger = getLogger('webhooks');

type WebhookEmitter = (kind: WebhookEventKind, payload: Record<string, unknown>) => void;

let testEmitter: WebhookEmitter | null = null;

/**
 * Test seam: lets route tests observe emitted events without the delivery
 * side effects (network calls, retry backoff) actually running.
 */
export function _setWebhookEmitter(fn: WebhookEmitter | null): void {
  testEmitter = fn;
}

/**
 * Fires a webhook event without blocking the response. Delivery (including
 * retry backoff up to 15 s) runs after the response is sent via `after()`,
 * and a delivery failure is logged, never thrown back into the request.
 */
export function emitWebhookEvent(kind: WebhookEventKind, payload: Record<string, unknown>): void {
  if (testEmitter) {
    testEmitter(kind, payload);
    return;
  }

  const event = makeWebhookEvent(kind, payload);
  const task = dispatchEvent(event, getWebhookStore()).catch((err) => {
    logger.warn({ event: 'webhook_dispatch_failed', kind, error: String(err) });
  });

  try {
    after(() => task);
  } catch {
    // `after` throws outside a request scope (unit tests, scripts) — the
    // dispatch is already in flight, so just let it run unattached.
    void task;
  }
}
