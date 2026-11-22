import type { AnchorRate } from '@/types';
import { parseDecimal } from './scheduler';

export interface RecurringOfframpParams {
  recurring: true;
  authId: string;
  sender?: string | undefined;
  corridorId?: string | undefined;
  amount?: string | undefined;
  sourceAsset?: string | undefined;
  destinationAsset?: string | undefined;
  period?: string | undefined;
  remainingCap?: string | undefined;
  allowlist?: string[] | undefined;
}

export function parseRecurringParams(
  searchParams: URLSearchParams | { get: (k: string) => string | null }
): RecurringOfframpParams | null {
  const rec = searchParams.get('recurring');
  const authId = searchParams.get('authId') || searchParams.get('id');

  if (rec !== '1' && rec !== 'true' && !authId) {
    return null;
  }

  if (!authId) {
    return null;
  }

  const allowlistRaw = searchParams.get('allowlist');
  const allowlist = allowlistRaw ? allowlistRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

  return {
    recurring: true,
    authId,
    sender: searchParams.get('sender') ?? undefined,
    corridorId: searchParams.get('corridorId') ?? undefined,
    amount: searchParams.get('amount') ?? undefined,
    sourceAsset: searchParams.get('sourceAsset') ?? undefined,
    destinationAsset: searchParams.get('destinationAsset') ?? undefined,
    period: searchParams.get('period') ?? undefined,
    remainingCap: searchParams.get('remainingCap') ?? undefined,
    allowlist,
  };
}

export function filterRatesToAllowlist(
  rates: AnchorRate[],
  allowlist: string[] | undefined
): AnchorRate[] {
  if (!allowlist || allowlist.length === 0) return rates;
  return rates.filter((r) => allowlist.includes(r.anchorId));
}

export function exceedsRemainingCap(amount: string, remainingCap: string): boolean {
  if (!amount || !remainingCap) return false;
  try {
    const amtScaled = parseDecimal(amount);
    const capScaled = parseDecimal(remainingCap);
    return amtScaled > capScaled;
  } catch {
    return false;
  }
}

export function withRecurringFields(
  intent: Record<string, unknown>,
  recurring: RecurringOfframpParams
): Record<string, unknown> {
  return {
    ...intent,
    recurring: true,
    authorizationId: recurring.authId,
  };
}
