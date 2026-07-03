import type { AnchorRate } from '@/types';
import { CORRIDORS, USDC_ASSET } from '@/constants/anchors';
import { fetchCorridorRates } from './server-rates';

/**
 * Best-anchor-per-corridor snapshot.
 *
 * The landing page needs a "MoneyGram is best for NGN right now" style teaser
 * (#B080) without paying the cost — or the failure modes — of a live multi-anchor
 * quote on first paint. This module computes that comparison once and caches it,
 * so the page is served from a stable, pre-computed shape instead of fanning out
 * to anchor endpoints on every visit.
 *
 * "Best" mirrors the live comparison exactly: the anchor with the highest
 * `totalReceived` for `baseAmount` of `baseAsset` on the corridor (see
 * {@link fetchCorridorRates}). Corridors where no anchor could be quoted carry a
 * null `best` so the teaser can render a graceful "—" rather than guessing.
 */

/** The winning anchor for a single corridor. */
export interface BestAnchorEntry {
  anchorId: string;
  anchorName: string;
  /** Fiat the user nets for `baseAmount` of `baseAsset`, in the corridor's `to` currency. */
  totalReceived: number;
  /** Effective local-currency units delivered per 1 unit of `baseAsset`. */
  exchangeRate: number;
  /** Provenance of the winning quote: firm SEP-38, indicative SEP-24 fee, etc. */
  source: AnchorRate['source'];
}

/** Per-corridor result: corridor metadata plus its best anchor (or null). */
export interface CorridorBest {
  corridorId: string;
  from: string;
  to: string;
  countryCode: string;
  countryName: string;
  /** Number of anchors that returned a usable quote for this corridor. */
  quoted: number;
  /** The best anchor, or null when no anchor on the corridor could be quoted. */
  best: BestAnchorEntry | null;
}

/**
 * Stable shape consumed by the landing teaser (#B080). Add fields, never rename
 * or remove — the teaser and any cron consumer depend on this contract.
 */
export interface BestAnchorSnapshot {
  /** ISO-8601 timestamp of when the comparison was computed. */
  generatedAt: string;
  /** Amount of `baseAsset` compared across anchors (e.g. "100"). */
  baseAmount: string;
  /** Asset sold into each corridor (USDC). */
  baseAsset: string;
  corridors: CorridorBest[];
}

const DEFAULT_BASE_AMOUNT = '100';

/** How long a computed snapshot is reused before the next request recomputes. */
const CACHE_TTL_MS = 10 * 60_000; // 10 minutes

let cache: { baseAmount: string; snapshot: BestAnchorSnapshot; expiresAt: number } | null = null;

function toCorridorBest(
  corridor: (typeof CORRIDORS)[number],
  rates: AnchorRate[],
  bestRateId: string
): CorridorBest {
  const winner = rates.find((r) => r.anchorId === bestRateId);
  const best: BestAnchorEntry | null =
    winner && winner.totalReceived !== null && winner.exchangeRate !== null
      ? {
          anchorId: winner.anchorId,
          anchorName: winner.anchorName,
          totalReceived: winner.totalReceived,
          exchangeRate: winner.exchangeRate,
          source: winner.source,
        }
      : null;

  return {
    corridorId: corridor.id,
    from: corridor.from,
    to: corridor.to,
    countryCode: corridor.countryCode,
    countryName: corridor.countryName,
    quoted: rates.length,
    best,
  };
}

/**
 * Computes a fresh snapshot by running the live comparison for every corridor.
 * Corridors are fetched concurrently; one corridor's failure never blocks another
 * (a failed corridor simply yields `best: null`). This makes live network calls —
 * prefer {@link getBestAnchorSnapshot}, which caches, for request-path use.
 */
export async function buildBestAnchorSnapshot(
  baseAmount: string = DEFAULT_BASE_AMOUNT
): Promise<BestAnchorSnapshot> {
  const corridors = await Promise.all(
    CORRIDORS.map(async (corridor): Promise<CorridorBest> => {
      try {
        const { rates, bestRateId } = await fetchCorridorRates(corridor.id, baseAmount);
        return toCorridorBest(corridor, rates, bestRateId);
      } catch {
        return toCorridorBest(corridor, [], '');
      }
    })
  );

  return {
    generatedAt: new Date().toISOString(),
    baseAmount,
    baseAsset: USDC_ASSET.code,
    corridors,
  };
}

/**
 * Returns the cached snapshot, recomputing it when the cache is cold, expired, or
 * built for a different `baseAmount`. A snapshot in which no corridor produced a
 * best anchor (e.g. a transient network outage) is returned but NOT cached, so a
 * blip never pins an empty teaser for the full TTL.
 */
export async function getBestAnchorSnapshot(opts?: {
  baseAmount?: string;
  forceRefresh?: boolean;
}): Promise<BestAnchorSnapshot> {
  const baseAmount = opts?.baseAmount ?? DEFAULT_BASE_AMOUNT;
  const now = Date.now();

  if (!opts?.forceRefresh && cache && cache.baseAmount === baseAmount && now < cache.expiresAt) {
    return cache.snapshot;
  }

  const snapshot = await buildBestAnchorSnapshot(baseAmount);
  if (snapshot.corridors.some((c) => c.best !== null)) {
    cache = { baseAmount, snapshot, expiresAt: now + CACHE_TTL_MS };
  }
  return snapshot;
}

/** Drops the in-process cache. Intended for tests and post-deploy cron warmers. */
export function clearBestAnchorSnapshotCache(): void {
  cache = null;
}
