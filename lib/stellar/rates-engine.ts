import { AnchorRate, RateComparison } from '@/types';
import { getAnchorsByCorridorId, getCorridorById } from './anchors';
import { fetchAnchorFee, AnchorRateError } from './sep24';
import { computeTotalReceived } from '@/lib/utils';

export interface RatesEngineOptions {
  onQuoteArrived?: (quote: AnchorRate) => void;
  timeoutMs?: number;
}

export async function fetchRates(
  corridorId: string,
  amount: string,
  options?: RatesEngineOptions
): Promise<RateComparison> {
  const anchors = getAnchorsByCorridorId(corridorId);
  const corridor = getCorridorById(corridorId);
  const timeoutMs = options?.timeoutMs ?? 1500; // 1.5s MVP timeout

  const pending: { anchorId: string; anchorName: string }[] = [];
  const quotes: AnchorRate[] = [];

  const promises = anchors.map(async (anchor) => {
    pending.push({ anchorId: anchor.id, anchorName: anchor.name });

    const fetchPromise = (async () => {
      const { fee, exchangeRate } = await fetchAnchorFee({
        anchorDomain: anchor.homeDomain,
        operation: 'withdraw',
        assetCode: anchor.assetCode,
        assetIssuer: anchor.assetIssuer,
        amount,
        type: 'bank_account',
      });

      const feeNum = Number(fee);
      const amountNum = Number(amount);

      if (exchangeRate <= 0) {
        throw new AnchorRateError(
          anchor.id,
          `${anchor.name} returned a zero or missing exchange rate for ${corridor.to} — rate cannot be derived`
        );
      }

      const totalReceived = computeTotalReceived(amountNum, feeNum, 0, exchangeRate);

      const rate: AnchorRate = {
        anchorId: anchor.id,
        anchorName: anchor.name,
        corridorId,
        fee: feeNum,
        feeType: 'flat',
        exchangeRate,
        totalReceived: totalReceived > 0 ? totalReceived : 0,
        source: 'sep24-fee',
        updatedAt: new Date(),
      };

      return rate;
    })();

    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => {
        resolve(null);
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([fetchPromise, timeoutPromise]);

      if (result) {
        // Arrived before timeout
        const pIdx = pending.findIndex((p) => p.anchorId === anchor.id);
        if (pIdx > -1) pending.splice(pIdx, 1);
        quotes.push(result);
      } else {
        // Timeout reached, wait in background
        fetchPromise
          .then((r) => {
            options?.onQuoteArrived?.(r);
          })
          .catch(() => {
            // Ignore background errors
          });
      }
    } catch {
      // Error fetching before timeout
      const pIdx = pending.findIndex((p) => p.anchorId === anchor.id);
      if (pIdx > -1) pending.splice(pIdx, 1);
    }
  });

  await Promise.allSettled(promises);

  let bestRateId = '';
  if (quotes.length > 0) {
    const best = quotes.reduce((a, b) => ((b.totalReceived ?? 0) > (a.totalReceived ?? 0) ? b : a));
    bestRateId = best.anchorId;
  }

  return {
    corridorId,
    rates: quotes,
    pending,
    bestRateId,
  };
}

/**
 * Deduplicates anchor rates that share the same SEP-38 quote id.
 *
 * Occasionally two anchors proxy the same underlying liquidity pool and so issue
 * the same firm-quote id. Surfacing both as distinct options would double-count a
 * single pool, skewing the comparison. This collapses such collisions to one rate.
 *
 * Rules:
 *  - Keyed by {@link AnchorRate.quoteId}. Rates without a quoteId cannot collide
 *    and are always kept (e.g. SEP-24 fee rates, unavailable placeholders).
 *  - On collision, the earliest-received rate wins — the first quote observed for
 *    a pool is treated as canonical and later duplicates are dropped. "Earliest"
 *    is measured by {@link AnchorRate.updatedAt}; ties keep the incumbent, so
 *    input order breaks them.
 *  - Relative order of the surviving rates is preserved (a deduped rate keeps the
 *    position of its first appearance).
 */
export function dedupeByQuoteId(rates: AnchorRate[]): AnchorRate[] {
  // Resolve, per quote id, which rate wins on collision.
  const winners = new Map<string, AnchorRate>();
  for (const rate of rates) {
    if (rate.quoteId === undefined) continue;
    const existing = winners.get(rate.quoteId);
    if (existing === undefined || rate.updatedAt.getTime() < existing.updatedAt.getTime()) {
      winners.set(rate.quoteId, rate);
    }
  }

  // Re-emit in original order. quoteId-less rates pass through untouched; each
  // colliding group is emitted once, at the position of its first appearance.
  const emitted = new Set<string>();
  const result: AnchorRate[] = [];
  for (const rate of rates) {
    if (rate.quoteId === undefined) {
      result.push(rate);
      continue;
    }
    if (emitted.has(rate.quoteId)) continue;
    emitted.add(rate.quoteId);
    result.push(winners.get(rate.quoteId)!);
  }

  return result;
}
