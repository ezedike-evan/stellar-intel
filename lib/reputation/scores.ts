/**
 * lib/reputation/scores.ts
 *
 * Server-side helper that fetches per-anchor composite reputation scores from
 * the leaderboard store and returns them as a lookup map keyed by anchorId.
 *
 * Used by server-rates.ts to annotate AnchorRate rows with reputationScore /
 * reputationRank so the UI can surface top-ranked anchors first (#801).
 */

import { ANCHORS } from '@/constants';
import { buildScorecards, mapOutcomeRows } from '@/lib/reputation/aggregate';
import { tryGetReputationStore } from '@/lib/reputation/store';
import { weightedComposite } from '@/lib/reputation/composite';

export interface AnchorReputationEntry {
  /** Composite reputation score in [0, 1]. */
  score: number;
  /** 1-based rank position sorted descending by score. */
  rank: number;
}

/**
 * Composite score formula (0–1, higher is better) — mirrors the formula in
 * app/api/reputation/leaderboard/route.ts so that route and server-rates agree.
 *
 *   composite = 0.4 × fill_rate
 *             + 0.3 × (1 − slippage_p50 / 0.05)
 *             + 0.3 × (1 − settle_p50 / 300)
 */
/**
 * Fetches reputation scores for all registered anchors and returns a lookup map.
 *
 * Failures are swallowed per-anchor so a broken store never blocks the rate
 * response — the reputationScore / reputationRank fields are simply absent on
 * anchors whose scores could not be retrieved.
 */
export async function fetchReputationScores(): Promise<Map<string, AnchorReputationEntry>> {
  // Null when no durable store is configured; every anchor then scores 0,
  // matching the per-anchor fallback below. Construction throws before any
  // query, so that inner catch could not cover this case on its own.
  const store = tryGetReputationStore();

  // Fetch scores for all anchors in parallel; swallow per-anchor errors.
  const scored: Array<{ anchorId: string; score: number }> = (
    await Promise.all(
      ANCHORS.map(async (anchor) => {
        try {
          const rows = store ? await store.query({ anchorId: anchor.id }) : [];
          const scorecard = buildScorecards(mapOutcomeRows(rows))[30];

          if (scorecard.state !== 'ok') {
            return { anchorId: anchor.id, score: 0 };
          }

          const fill_rate = scorecard.fillRate;
          const settle_p50 = scorecard.settleMs.p50 / 1000;
          const slippage_p50 = scorecard.slippage.p50;

          return {
            anchorId: anchor.id,
            score: weightedComposite(fill_rate, settle_p50, slippage_p50),
          };
        } catch {
          // Store unavailable (e.g. no DATABASE_URL in dev) — return 0, not an error.
          return { anchorId: anchor.id, score: 0 };
        }
      })
    )
  ).filter((entry): entry is { anchorId: string; score: number } => entry !== null);

  // Sort descending by score, then assign 1-based rank.
  scored.sort((a, b) => b.score - a.score);

  const result = new Map<string, AnchorReputationEntry>();
  scored.forEach((entry, index) => {
    result.set(entry.anchorId, { score: entry.score, rank: index + 1 });
  });

  return result;
}
