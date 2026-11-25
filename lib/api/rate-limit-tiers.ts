import type { CallerTierName } from '@/lib/auth/caller';

export const TIER_MULTIPLIER: Record<CallerTierName, number> = {
  anonymous: 1,
  standard: 5,
  partner: 20,
};

export function limitForTier(base: number, tier: CallerTierName): number {
  return base * TIER_MULTIPLIER[tier];
}
