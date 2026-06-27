import { z } from 'zod';

export const Sep6WithdrawInteractiveSchema = z.object({
  type: z.literal('interactive_customer_info_needed'),
  url: z.string().url(),
  id: z.string(),
});

export const Sep6WithdrawNonInteractiveSchema = z.object({
  type: z.literal('non_interactive'),
  id: z.string(),
  eta: z.number().int().optional(),
  min_amount: z.number().optional(),
  max_amount: z.number().optional(),
  amount_in: z.string().optional(),
  amount_out: z.string().optional(),
  amount_fee: z.string().optional(),
  extra_info: z.object({ message: z.string().optional() }).optional(),
});

export const Sep6WithdrawFieldSchema = z.object({
  description: z.string(),
  choices: z.array(z.string()).optional(),
  optional: z.boolean().optional(),
});

export const Sep6WithdrawNeedsInfoSchema = z.object({
  type: z.literal('customer_info_status'),
  fields: z.record(z.string(), Sep6WithdrawFieldSchema),
});

export const Sep6WithdrawResponseSchema = z.discriminatedUnion('type', [
  Sep6WithdrawInteractiveSchema,
  Sep6WithdrawNonInteractiveSchema,
  Sep6WithdrawNeedsInfoSchema,
]);

export type Sep6WithdrawInteractive = z.infer<typeof Sep6WithdrawInteractiveSchema>;
export type Sep6WithdrawNonInteractive = z.infer<typeof Sep6WithdrawNonInteractiveSchema>;
export type Sep6WithdrawNeedsInfo = z.infer<typeof Sep6WithdrawNeedsInfoSchema>;
export type Sep6WithdrawResponse = z.infer<typeof Sep6WithdrawResponseSchema>;
