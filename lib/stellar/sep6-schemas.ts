import { z } from 'zod';

/**
 * Zod schemas for the SEP-6 GET /info response, validated at the network
 * boundary so a malformed anchor payload throws a structured zod error rather
 * than crashing downstream consumers. Mirrors lib/stellar/sep38-schemas.ts.
 */

/** A single required/optional field an anchor expects for a deposit or withdraw. */
export const Sep6FieldSchema = z.object({
  description: z.string().optional(),
  optional: z.boolean().optional(),
  choices: z.array(z.string()).optional(),
});

/** Per-asset deposit/withdraw entry: enablement, fees, limits, and required fields. */
export const Sep6AssetInfoSchema = z.object({
  enabled: z.boolean(),
  authentication_required: z.boolean().optional(),
  fee_fixed: z.number().optional(),
  fee_percent: z.number().optional(),
  min_amount: z.number().optional(),
  max_amount: z.number().optional(),
  fields: z.record(z.string(), Sep6FieldSchema).optional(),
});

/** Enablement flag for the simple SEP-6 endpoints (fee, transaction, transactions). */
const Sep6EndpointSchema = z.object({
  enabled: z.boolean(),
  authentication_required: z.boolean().optional(),
});

/** GET /info — advertised deposit/withdraw asset maps plus endpoint capabilities. */
export const Sep6InfoSchema = z.object({
  deposit: z.record(z.string(), Sep6AssetInfoSchema).optional().default({}),
  withdraw: z.record(z.string(), Sep6AssetInfoSchema).optional().default({}),
  'deposit-exchange': z.record(z.string(), Sep6AssetInfoSchema).optional(),
  'withdraw-exchange': z.record(z.string(), Sep6AssetInfoSchema).optional(),
  fee: Sep6EndpointSchema.optional(),
  transaction: Sep6EndpointSchema.optional(),
  transactions: Sep6EndpointSchema.optional(),
});

export type Sep6Field = z.infer<typeof Sep6FieldSchema>;
export type Sep6AssetInfo = z.infer<typeof Sep6AssetInfoSchema>;
export type Sep6Info = z.infer<typeof Sep6InfoSchema>;
