import type { CallerTierName } from '@/lib/auth/caller';

/**
 * Per-tier rate-limit budgets (AGS007, AGS016).
 *
 * Anonymous callers keep exactly the budget they had before keys existed
 * (multiplier 1), so every existing limit and spec is unaffected. A keyed
 * caller gets headroom in proportion to its tier instead of sharing one
 * per-IP budget with every agent behind the same NAT or cloud egress.
 */
export const TIER_MULTIPLIER: Record<CallerTierName, number> = {
  anonymous: 1,
  standard: 5,
  partner: 20,
};

/** The budget for `tier`, scaled from the anonymous `base` limit. */
export function limitForTier(base: number, tier: CallerTierName): number {
  return base * TIER_MULTIPLIER[tier];
}
