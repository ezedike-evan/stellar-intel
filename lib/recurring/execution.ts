import { z } from 'zod';
import { Keypair } from '@stellar/stellar-sdk';
import { canonicalJson, type HashableIntent } from '@/lib/intent/hash';

export const RecurringExecutionIntentSchema = z.object({
  type: z.literal('recurring-execution'),
  version: z.literal(1),
  authorizationId: z.string().regex(/^[0-9a-f]{64}$/, {
    message: 'authorizationId must match the 64-char hex termsHash',
  }),
  sender: z.string().regex(/^G[A-Z0-9]{55}$/, {
    message: 'sender must be a valid Stellar public key',
  }),
  anchorId: z.string().min(1, { message: 'anchorId is required' }),
  amount: z
    .string()
    .regex(/^\d+(\.\d+)?$/, { message: 'amount must be a non-negative decimal string' })
    .refine((v) => parseFloat(v) > 0, { message: 'amount must be greater than zero' }),
  minReceive: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
  cycleIndex: z.number().int().nonnegative().optional(),
  timestamp: z.number().int().positive(),
  nonce: z.string().min(1, { message: 'nonce is required' }),
});

export type RecurringExecutionIntent = z.infer<typeof RecurringExecutionIntentSchema>;

export const SignedRecurringExecutionSchema = z.object({
  intent: RecurringExecutionIntentSchema,
  intentHash: z.string().regex(/^[0-9a-f]{64}$/, { message: 'intentHash must be a 64-char hex string' }),
  signature: z.string().min(1, { message: 'signature is required' }),
  publicKey: z.string().regex(/^G[A-Z0-9]{55}$/, { message: 'publicKey must be a valid Stellar public key' }),
});

export type SignedRecurringExecution = z.infer<typeof SignedRecurringExecutionSchema>;

export async function hashRecurringExecution(intent: RecurringExecutionIntent): Promise<string> {
  const canonical = canonicalJson(intent as unknown as HashableIntent);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyRecurringExecution(
  signed: SignedRecurringExecution,
  expectedSender: string
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const parseRes = RecurringExecutionIntentSchema.safeParse(signed?.intent);
  if (!parseRes.success) {
    return {
      ok: false,
      code: 'INVALID_INTENT',
      message: parseRes.error.issues.map((i) => i.message).join('; '),
    };
  }

  const computedHash = await hashRecurringExecution(parseRes.data);
  if (computedHash !== signed.intentHash) {
    return {
      ok: false,
      code: 'HASH_MISMATCH',
      message: `Computed hash ${computedHash} does not match intentHash ${signed.intentHash}`,
    };
  }

  if (signed.publicKey !== expectedSender || parseRes.data.sender !== expectedSender) {
    return {
      ok: false,
      code: 'SIGNER_MISMATCH',
      message: `Signer ${signed.publicKey} does not match expected sender ${expectedSender}`,
    };
  }

  try {
    const kp = Keypair.fromPublicKey(signed.publicKey);
    const dataBytes = new TextEncoder().encode(signed.intentHash);
    const sigBytes = Buffer.from(signed.signature, 'base64');
    const valid = kp.verify(dataBytes, sigBytes);
    if (!valid) {
      return {
        ok: false,
        code: 'INVALID_SIGNATURE',
        message: 'Signature check failed against execution intentHash',
      };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Invalid signature format';
    return {
      ok: false,
      code: 'INVALID_SIGNATURE',
      message: msg,
    };
  }

  return { ok: true };
}
