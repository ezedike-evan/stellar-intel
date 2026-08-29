import { randomUUID } from 'crypto';
import type { WebhookEvent, WebhookEventKind } from './types';

export function makeWebhookEvent(
  kind: WebhookEventKind,
  payload: Record<string, unknown>
): WebhookEvent {
  return {
    id: randomUUID(),
    kind,
    createdAt: new Date().toISOString(),
    payload,
  };
}
