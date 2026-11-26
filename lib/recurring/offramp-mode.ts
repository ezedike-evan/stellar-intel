import { compareDecimals } from '@/lib/decimal';
import type { Intent } from '@/lib/intent/hash';

// ─── Standing-order mode for /offramp (REC011) ───────────────────────────────
//
// Pure helpers the off-ramp page uses when it is opened from a due reminder:
// read the standing order from the URL, limit the rate table to the signed
// allowlist, guard the remaining cap, and add the standing order fields to the
// outcome intent the user already signs. Browser-safe: no server imports.

export interface RecurringOfframpContext {
  authorizationId: string;
  cycleNumber: number;
  anchorAllowlist: string[];
  remainingCap: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CYCLE_PATTERN = /^[1-9]\d*$/;

/** `?recurring=<uuid>&cycle=<n>`, with n an integer of 1 or more; otherwise null. */
export function parseRecurringParams(
  search: string
): { authorizationId: string; cycleNumber: number } | null {
  const params = new URLSearchParams(search);
  const authorizationId = params.get('recurring');
  const cycle = params.get('cycle');
  if (!authorizationId || !UUID_PATTERN.test(authorizationId)) return null;
  if (!cycle || !CYCLE_PATTERN.test(cycle)) return null;
  const cycleNumber = Number(cycle);
  if (!Number.isSafeInteger(cycleNumber)) return null;
  return { authorizationId, cycleNumber };
}

export function filterRatesToAllowlist<T extends { anchorId: string }>(
  rates: T[],
  allowlist: string[]
): T[] {
  const allowed = new Set(allowlist);
  return rates.filter((rate) => allowed.has(rate.anchorId));
}

/** The outcome intent plus the standing order it confirms (REC009's schema). */
export function withRecurringFields(
  intent: Intent,
  ctx: RecurringOfframpContext
): Intent & { recurringAuthorizationId: string; cycleNumber: number } {
  return {
    ...intent,
    recurringAuthorizationId: ctx.authorizationId,
    cycleNumber: ctx.cycleNumber,
  };
}

/** True when `amount` is more than what is left of this period's cap. */
export function exceedsRemainingCap(amount: string, remainingCap: string): boolean {
  return compareDecimals(amount, remainingCap) > 0;
}
