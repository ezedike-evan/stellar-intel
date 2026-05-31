import type { WithdrawStatus, WithdrawStatusValue } from '@/types'

/**
 * Maps every raw SEP-24 anchor status string to the canonical WithdrawStatus enum.
 *
 * The Record type enforces exhaustiveness at compile time: adding a new
 * WithdrawStatusValue without a corresponding entry here is a type error.
 */
export const STATUS_MAP: Record<WithdrawStatusValue, WithdrawStatus> = {
  incomplete: 'pending_user_action',
  pending_user_transfer_start: 'pending_user_action',
  pending_user_transfer_complete: 'pending_user_action',
  pending_user: 'pending_user_action',
  pending_anchor: 'pending_anchor',
  pending_trust: 'pending_anchor',
  pending_stellar: 'pending_stellar',
  pending_external: 'pending_external',
  completed: 'completed',
  refunded: 'refunded',
  no_market: 'no_market',
  expired: 'expired',
  too_small: 'error',
  too_large: 'error',
  error: 'error',
}

/** Converts a raw anchor status string into the canonical WithdrawStatus. */
export function mapToCanonical(raw: WithdrawStatusValue): WithdrawStatus {
  return STATUS_MAP[raw]
}
