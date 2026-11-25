import { tryGetReputationStore } from '@/lib/reputation/store';
import { getSlippageBreachStore } from '@/lib/reputation/slippage-breaches';
import {
  computeSlippageCompliance,
  type SlippageCompliance,
  type SlippageComplianceWindow,
} from './slippage-compliance';

/**
 * Loads eligible withdraw outcomes and slippage breaches from their respective
 * stores and computes the slippage compliance metrics.
 *
 * Returns null if the underlying store is unavailable or querying fails.
 */
export async function loadSlippageCompliance(
  window: SlippageComplianceWindow,
  now: number = Date.now()
): Promise<SlippageCompliance | null> {
  try {
    const store = tryGetReputationStore();
    if (!store) return null;

    const breachStore = getSlippageBreachStore();
    const rows = await store.query({ direction: 'withdraw' });
    const since =
      window === 'all' ? undefined : new Date(now - window * 24 * 60 * 60 * 1000).toISOString();
    const breaches = await breachStore.list({
      ...(since ? { since } : {}),
      limit: 100_000,
    });

    return computeSlippageCompliance(rows, breaches, { window, now });
  } catch {
    return null;
  }
}
