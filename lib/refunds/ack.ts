import { z } from 'zod';
import { STELLAR_PUBKEY_PATTERN, AMOUNT_PATTERN } from '@/lib/patterns';
import type { Sep24Refunds } from '@/types';
import { hashCanonical } from '@/lib/intent/hash';

export const REFUND_ACK_TYPE = 'refund-ack' as const;
export const REFUND_ACK_VERSION = 1 as const;

export interface RefundAckPayment {
  id: string;
  idType: 'stellar' | 'external';
  amount: string;
}

export interface RefundAckPayload {
  type: typeof REFUND_ACK_TYPE;
  version: typeof REFUND_ACK_VERSION;
  intentHash: string;
  anchorId: string;
  account: string;
  amountRefunded: string;
  refundFee: string;
  payments: RefundAckPayment[];
}

export const RefundAckPaymentSchema = z
  .object({
    id: z.string().min(1).max(128),
    idType: z.enum(['stellar', 'external']),
    amount: z.string().regex(AMOUNT_PATTERN).max(40),
  })
  .strict();

export const RefundAckPayloadSchema = z
  .object({
    type: z.literal(REFUND_ACK_TYPE),
    version: z.literal(REFUND_ACK_VERSION),
    intentHash: z.string().regex(/^[0-9a-f]{64}$/),
    anchorId: z.string().min(1).max(64),
    account: z.string().regex(STELLAR_PUBKEY_PATTERN),
    amountRefunded: z.string().regex(AMOUNT_PATTERN).max(40),
    refundFee: z.string().regex(AMOUNT_PATTERN).max(40),
    payments: z.array(RefundAckPaymentSchema).max(20),
  })
  .strict();

/**
 * Build a canonical RefundAckPayload from an anchor's SEP-24 refunds object,
 * preserving payment order, mapping id_type to idType, dropping per-payment fee,
 * and populating amountRefunded and refundFee.
 */
export function buildRefundAck(input: {
  intentHash: string;
  anchorId: string;
  account: string;
  refunds: Sep24Refunds;
}): RefundAckPayload {
  return {
    type: REFUND_ACK_TYPE,
    version: REFUND_ACK_VERSION,
    intentHash: input.intentHash,
    anchorId: input.anchorId,
    account: input.account,
    amountRefunded: input.refunds.amount_refunded,
    refundFee: input.refunds.amount_fee,
    payments: input.refunds.payments.map((p) => ({
      id: p.id,
      idType: p.id_type as 'stellar' | 'external',
      amount: p.amount,
    })),
  };
}

/**
 * Compute the 64-character lowercase hex SHA-256 hash of a RefundAckPayload
 * serialized to canonical JSON.
 */
export async function hashRefundAck(ack: RefundAckPayload): Promise<string> {
  return hashCanonical(ack);
}
