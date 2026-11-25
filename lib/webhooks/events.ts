import { randomUUID } from 'crypto';
import type { WebhookEvent, WebhookEventKind, WebhookEventPayloadMap } from './types';

export function makeWebhookEvent<K extends WebhookEventKind>(
  kind: K,
  payload: WebhookEventPayloadMap[K],
  opts?: { idempotencyKey?: string }
): WebhookEvent {
  const id = randomUUID();
  return {
    id,
    kind,
    createdAt: new Date().toISOString(),
    // A producer that can retry passes a deterministic key; without one the event is unique.
    idempotencyKey: opts?.idempotencyKey ?? `${kind}:${id}`,
    payload,
  };
}
