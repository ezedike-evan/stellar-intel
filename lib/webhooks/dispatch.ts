import { randomUUID } from 'crypto';
import type { WebhookEvent, WebhookSubscription, DeliveryRecord } from './types';
import type { WebhookStore } from './store';
import { buildSignatureHeader } from './sign';

const MAX_ATTEMPTS = 5;

export type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function backoffMs(attempt: number): number {
  // attempt is 0-indexed; first retry = 1 s, then 2 s, 4 s, 8 s
  return Math.min(1_000 * Math.pow(2, attempt), 30_000);
}

export async function deliverToSubscription(
  sub: WebhookSubscription,
  event: WebhookEvent,
  store: WebhookStore,
  sleepFn: SleepFn = defaultSleep
): Promise<void> {
  const rawBody = JSON.stringify(event);
  let attempts = 0;
  let lastStatusCode: number | null = null;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleepFn(backoffMs(attempt - 1));
    }
    attempts++;
    const timestampSec = Math.floor(Date.now() / 1000);
    const sigHeader = buildSignatureHeader(sub.secret, timestampSec, rawBody);

    try {
      const resp = await fetch(sub.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': sigHeader,
          'x-webhook-timestamp': String(timestampSec),
        },
        body: rawBody,
      });
      lastStatusCode = resp.status;

      if (resp.ok) {
        const record: DeliveryRecord = {
          id: randomUUID(),
          eventId: event.id,
          eventKind: event.kind,
          subscriptionId: sub.id,
          url: sub.url,
          status: 'success',
          attempts,
          lastStatusCode,
          lastError: null,
          deliveredAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        await store.recordDelivery(record);
        return;
      }
      lastError = `HTTP ${resp.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'unknown error';
      lastStatusCode = null;
    }
  }

  // All attempts exhausted — move to dead-letter
  const record: DeliveryRecord = {
    id: randomUUID(),
    eventId: event.id,
    eventKind: event.kind,
    subscriptionId: sub.id,
    url: sub.url,
    status: 'dead_letter',
    attempts,
    lastStatusCode,
    lastError,
    deliveredAt: null,
    createdAt: new Date().toISOString(),
  };
  await store.recordDelivery(record);
}

export async function dispatchEvent(
  event: WebhookEvent,
  store: WebhookStore,
  sleepFn?: SleepFn
): Promise<void> {
  const subs = await store.listSubscriptions();
  const matching = subs.filter((s) => s.events.includes(event.kind));
  await Promise.allSettled(
    matching.map((sub) => deliverToSubscription(sub, event, store, sleepFn))
  );
}
