import { AnchorError, NetworkError, TimeoutError, UserRejectedError } from '@/lib/stellar/errors';
import { NetworkMismatchError } from '@/lib/stellar/sep10';
import { Sep24WithdrawError } from '@/lib/stellar/sep24';
import { QuoteExpiredError } from '@/lib/stellar/sep38';

/**
 * Maps an ExecuteDrawer failure to a human-readable message a user can act
 * on. Falls back to the raw error message for anything unclassified, so this
 * never hides diagnostic information — it only replaces the common cases
 * that would otherwise surface as an opaque Horizon result_codes summary or
 * anchor HTTP error string.
 */
export function classifyExecuteError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Unknown error';

  if (err instanceof NetworkMismatchError) return message;
  if (err instanceof UserRejectedError) return 'Freighter rejected the signature request.';
  if (err instanceof QuoteExpiredError) {
    return 'Your firm quote expired before the transaction could complete. Get a new quote to continue at the current price.';
  }

  const lower = message.toLowerCase();

  if (lower.includes('underfunded') || lower.includes('insufficient')) {
    return 'Horizon rejected the transaction — check your USDC balance.';
  }
  if (lower.includes('op_no_trust') || lower.includes('no trust')) {
    return 'Your wallet does not have a trustline for this asset yet.';
  }
  if (lower.includes('expired')) {
    return 'Anchor challenge expired — refresh and try again.';
  }

  return message;
}

/**
 * Whether re-running the same ExecuteDrawer flow from the top is likely to
 * succeed. Transient failures (timeouts, 5xx, network drops) are retryable;
 * failures that need the user to change something first (expired challenge,
 * missing trustline, insufficient balance, a network mismatch) are not — the
 * same conditions will just fail again.
 */
export function isRetryableExecuteError(err: unknown): boolean {
  if (err instanceof NetworkMismatchError) return false;
  if (err instanceof UserRejectedError) return false;
  if (err instanceof QuoteExpiredError) return true;
  if (err instanceof TimeoutError) return true;
  if (err instanceof NetworkError) return true;
  if (err instanceof AnchorError) return err.httpStatus === 0 || err.httpStatus >= 500;
  if (err instanceof Sep24WithdrawError) return err.status === 0 || err.status >= 500;

  const message = err instanceof Error ? err.message.toLowerCase() : '';
  if (
    message.includes('expired') ||
    message.includes('underfunded') ||
    message.includes('insufficient') ||
    message.includes('no trust')
  ) {
    return false;
  }
  if (message.includes('timeout') || message.includes('network') || message.includes('fetch')) {
    return true;
  }

  // Unclassified — default to retryable since "Start over" throws away
  // strictly more (the whole in-progress flow) than "Retry" for no
  // established benefit.
  return true;
}
