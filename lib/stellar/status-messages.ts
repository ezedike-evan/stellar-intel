import type { WithdrawStatusValue } from '@/types';

const NON_TERMINAL_EXPLAINERS: Partial<Record<WithdrawStatusValue, string>> = {
  incomplete: 'Your withdrawal details are being finalized.',
  pending_user_transfer_start: 'Waiting for the USDC payment to reach the anchor.',
  pending_user_transfer_complete: 'The anchor has received your USDC and is processing it.',
  pending_external: 'The anchor is processing your bank transfer.',
  pending_anchor: 'The anchor is manually reviewing your withdrawal.',
  pending_stellar: 'Waiting for the Stellar network to confirm the transaction.',
  pending_trust: 'Waiting for the required trustline to be established.',
  pending_user: 'The anchor needs additional information from you to continue.',
};

const NON_TERMINAL_TIME_ESTIMATES: Partial<Record<WithdrawStatusValue, string>> = {
  incomplete: '~1 min',
  pending_user_transfer_start: '~1–2 min',
  pending_user_transfer_complete: '~1–5 min',
  pending_external: '~5–30 min',
  pending_anchor: '~10–60 min',
  pending_stellar: '~5–10 sec',
  pending_trust: '~1 min',
};

/**
 * One-line explanation of what a non-terminal status means. Estimates are
 * maintainer-set constants, not derived from live anchor data. Returns null
 * for terminal statuses (completed and all failure states).
 */
export function statusExplainer(status: WithdrawStatusValue): string | null {
  return NON_TERMINAL_EXPLAINERS[status] ?? null;
}

/** Rough "usually takes about this long" estimate for a non-terminal status. */
export function statusTimeEstimate(status: WithdrawStatusValue): string | null {
  return NON_TERMINAL_TIME_ESTIMATES[status] ?? null;
}

/**
 * Human-readable explanation for a terminal *failure* status, distinguishing
 * an anchor-side error from a refund from an expiry — each implies a
 * different next step for the user. Returns null for non-terminal or
 * successful (`completed`) statuses.
 */
export function terminalErrorMessage(
  status: WithdrawStatusValue,
  transactionId: string
): string | null {
  switch (status) {
    case 'error':
      return `The anchor reported an error. Your USDC was not settled. Contact anchor support with transaction ID ${transactionId}.`;
    case 'refunded':
      return 'The anchor refunded your USDC. Check your Stellar wallet.';
    case 'expired':
      return 'The transaction expired before settlement. Your USDC was not sent.';
    default:
      return null;
  }
}
