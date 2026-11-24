/**
 * Intent template schemas and validators.
 *
 * Strict objects are deliberate: an unknown key such as `recipientName` or `bankAccount`
 * is a parse error, so PII cannot be smuggled in through storage or import.
 */
import { z } from 'zod';
import { OfframpIntentSchema, OnrampIntentSchema, OnrampDepositMethodSchema } from '@/types/intent';

export const TEMPLATE_SCHEMA_VERSION = 1;
export const TEMPLATE_LABEL_MAX = 60;
export const MAX_TEMPLATES_PER_WALLET = 50;
export type TemplateDirection = 'offramp' | 'onramp';

export const OfframpTemplateSchema = z.strictObject({
  schemaVersion: z.literal(TEMPLATE_SCHEMA_VERSION),
  id: z.string().min(1).max(64),
  direction: z.literal('offramp'),
  label: z
    .string()
    .trim()
    .min(1, 'Give the template a name')
    .max(TEMPLATE_LABEL_MAX, 'Keep the name under 60 characters')
    .regex(/^[^\x00-\x1f\x7f]*$/, 'Name contains invalid characters'),
  corridorId: OfframpIntentSchema.shape.corridorId,
  amount: OfframpIntentSchema.shape.amount,
  anchorId: OfframpIntentSchema.shape.anchorId.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().optional(),
});

export const OnrampTemplateSchema = z.strictObject({
  schemaVersion: z.literal(TEMPLATE_SCHEMA_VERSION),
  id: z.string().min(1).max(64),
  direction: z.literal('onramp'),
  label: z
    .string()
    .trim()
    .min(1, 'Give the template a name')
    .max(TEMPLATE_LABEL_MAX, 'Keep the name under 60 characters')
    .regex(/^[^\x00-\x1f\x7f]*$/, 'Name contains invalid characters'),
  corridorId: z.string().min(1),
  amount: OnrampIntentSchema.shape.amount,
  anchorId: z.string().min(1).optional(),
  assetId: z.string().regex(/^stellar:(native|[A-Za-z0-9]{1,12}:G[A-Z2-7]{55})$/).optional(),
  depositMethod: OnrampDepositMethodSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().optional(),
});

export const IntentTemplateSchema = z.discriminatedUnion('direction', [
  OfframpTemplateSchema,
  OnrampTemplateSchema,
]);
export type IntentTemplate = z.infer<typeof IntentTemplateSchema>;

export const OfframpTemplateInputSchema = OfframpTemplateSchema.omit({
  schemaVersion: true,
  id: true,
  createdAt: true,
  updatedAt: true,
  lastUsedAt: true,
});

export const OnrampTemplateInputSchema = OnrampTemplateSchema.omit({
  schemaVersion: true,
  id: true,
  createdAt: true,
  updatedAt: true,
  lastUsedAt: true,
});

export const IntentTemplateInputSchema = z.discriminatedUnion('direction', [
  OfframpTemplateInputSchema,
  OnrampTemplateInputSchema,
]);

export type IntentTemplateInput = z.infer<typeof IntentTemplateInputSchema>;
export type OfframpTemplateInput = z.infer<typeof OfframpTemplateInputSchema>;
export type OnrampTemplateInput = z.infer<typeof OnrampTemplateInputSchema>;

/** A template awaiting a name (used by the "save as template" form). */
export type IntentTemplateDraft =
  | Omit<OfframpTemplateInput, 'label'>
  | Omit<OnrampTemplateInput, 'label'>;

export const TEMPLATE_EXPORT_FORMAT = 'stellar-intel/intent-templates';

export const IntentTemplateExportSchema = z.strictObject({
  format: z.literal(TEMPLATE_EXPORT_FORMAT),
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  templates: z.array(IntentTemplateSchema).max(MAX_TEMPLATES_PER_WALLET),
});
export type IntentTemplateExport = z.infer<typeof IntentTemplateExportSchema>;

export function templateCorridorLabel(corridorId: string): string {
  return corridorId
    .split('-')
    .map((s) => s.toUpperCase())
    .join(' → ');
}

export function isTemplateCorridorAvailable(
  t: IntentTemplate,
  visibleCorridorIds: ReadonlySet<string>
): boolean {
  return visibleCorridorIds.has(t.corridorId);
}
