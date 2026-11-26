import { z } from 'zod';
import { AMOUNT_PATTERN, STELLAR_PUBKEY_PATTERN } from '@/lib/patterns';
import type { StandingAuthorizationStatus } from '@/types/recurring';

export const RecurringControlSchema = z
  .object({
    type: z.literal('recurring-control'),
    action: z.enum(['pause', 'resume', 'cancel']),
    authorizationId: z.string().uuid(),
    sender: z.string().regex(STELLAR_PUBKEY_PATTERN),
    sourceAsset: z.string().min(1),
    destinationAsset: z.string().min(1),
    amount: z.string().regex(AMOUNT_PATTERN),
    nonce: z.string().regex(/^[0-9a-f]{32}$/),
    deadline: z.iso.datetime(),
  })
  .strict();

export type RecurringControl = z.infer<typeof RecurringControlSchema>;

export function applyControlAction(
  status: StandingAuthorizationStatus,
  action: 'pause' | 'resume' | 'cancel'
): { ok: true; status: StandingAuthorizationStatus } | { ok: false; code: 'invalid_transition' } {
  if (status === 'active' && action === 'pause') {
    return { ok: true, status: 'paused' };
  }
  if (status === 'paused' && action === 'resume') {
    return { ok: true, status: 'active' };
  }
  if ((status === 'active' || status === 'paused') && action === 'cancel') {
    return { ok: true, status: 'cancelled' };
  }
  return { ok: false, code: 'invalid_transition' };
}
