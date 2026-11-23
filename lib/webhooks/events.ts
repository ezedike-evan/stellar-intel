import { randomUUID } from 'crypto';
import type { WebhookEvent, WebhookEventKind, WebhookEventPayloadMap } from './types';

export function makeWebhookEvent<K extends WebhookEventKind>(
  kind: K,
  payload: WebhookEventPayloadMap[K]
): WebhookEvent {
  return {
    id: randomUUID(),
    kind,
    createdAt: new Date().toISOString(),
    payload,
  };
}
