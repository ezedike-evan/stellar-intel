import { z } from 'zod';
import { WEBHOOK_PAYLOAD_SCHEMAS, type WebhookEventKind } from '@/types/webhooks';
import { isPublicHttpsUrl } from './url';

export const WEBHOOK_EVENT_KINDS = Object.keys(WEBHOOK_PAYLOAD_SCHEMAS) as WebhookEventKind[];

export const WebhookEventKindSchema = z.enum(
  WEBHOOK_EVENT_KINDS as [WebhookEventKind, ...WebhookEventKind[]]
);

export const CreateSubscriptionSchema = z.object({
  url: z.string().url({ message: 'url must be a valid URL' }).refine(isPublicHttpsUrl, {
    message: 'url must be a public https endpoint',
  }),
  events: z
    .array(WebhookEventKindSchema)
    .min(1, { message: 'at least one event type is required' }),
});

export type CreateSubscriptionInput = z.infer<typeof CreateSubscriptionSchema>;
