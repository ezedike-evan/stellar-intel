import { z } from 'zod';
import type { WebhookEventKind } from './types';

export const WEBHOOK_EVENT_KINDS = [
  'intent.created',
  'intent.settled',
  'intent.failed',
  'reputation.event_written',
  'anchor.health_status_changed',
] as const satisfies WebhookEventKind[];

export const WebhookEventKindSchema = z.enum(WEBHOOK_EVENT_KINDS);

export const CreateSubscriptionSchema = z.object({
  url: z.string().url({ message: 'url must be a valid URL' }),
  events: z
    .array(WebhookEventKindSchema)
    .min(1, { message: 'at least one event type is required' }),
});

export type CreateSubscriptionInput = z.infer<typeof CreateSubscriptionSchema>;
