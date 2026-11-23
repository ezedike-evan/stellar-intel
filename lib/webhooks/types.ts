export type { WebhookEventKind, WebhookEventPayloadMap } from '@/types/webhooks';
import type { WebhookEventKind } from '@/types/webhooks';

export interface WebhookEvent {
  id: string;
  kind: WebhookEventKind;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface WebhookSubscription {
  id: string;
  url: string;
  /** HMAC-SHA256 secret — never returned to callers after creation. */
  secret: string;
  events: WebhookEventKind[];
  createdAt: string;
}

export type DeliveryStatus = 'success' | 'failed' | 'dead_letter';

export interface DeliveryRecord {
  id: string;
  eventId: string;
  eventKind: WebhookEventKind;
  subscriptionId: string;
  url: string;
  status: DeliveryStatus;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  deliveredAt: string | null;
  createdAt: string;
}
