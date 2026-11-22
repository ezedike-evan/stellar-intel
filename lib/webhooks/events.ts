import { randomUUID } from 'crypto';
import type { WebhookEvent, WebhookEventKind } from './types';

export function makeWebhookEvent(
  kind: WebhookEventKind,
  payload: Record<string, unknown>,
  opts?: { idempotencyKey?: string }
): WebhookEvent {
  const id = randomUUID();
  return {
    id,
    idempotencyKey: opts?.idempotencyKey ?? `${kind}:${id}`,
    kind,
    createdAt: new Date().toISOString(),
    payload,
  };
}
