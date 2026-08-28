import { ANCHORS } from '@/constants';
import { getLogger } from '@/lib/logger';
import { buildScorecards, mapOutcomeRows } from '@/lib/reputation/aggregate';
import { composite } from '@/lib/reputation/composite';
import { computeLatencyPercentiles, tryGetReputationStore } from '@/lib/reputation/store';

const log = getLogger('reputation/scoring-inputs');

// ─── Real routing inputs (Issue #790) ─────────────────────────────────────────
//
// The multi-factor scorer in lib/router/solve.ts accepts reliability, latency
// and a reputation composite, but nothing ever supplied them — it was dead code
// with default arguments. This assembles them from data the system already
// collects.
//
// Every field is optional and every failure degrades to absent rather than to a
// guess. A fabricated reliability of 1.0 for an anchor with no probe history
// would silently promote the anchor we know least about, which is the opposite
// of what a reputation signal is for.

export interface AnchorScoringMetrics {
  reliability?: number;
  latencyMs?: number;
  reputationComposite?: number;
}

export interface ScoringInputsResult {
  anchorMetrics: Record<string, AnchorScoringMetrics>;
  /** Anchor ids that yielded no usable signal, for logging. */
  missing: string[];
}

/** Probe samples are keyed by home domain; the scorer speaks anchor ids. */
function domainForAnchor(anchorId: string): string | undefined {
  return ANCHORS.find((a) => a.id === anchorId)?.homeDomain;
}

/**
 * Assembles scoring metrics for `anchorIds` from the reputation store.
 *
 * Never throws: an unavailable store yields empty metrics, and the caller falls
 * back to rate-only scoring. Routing must not fail because reputation data is
 * missing — it should just stop being reputation-aware.
 */
export async function collectScoringInputs(anchorIds: string[]): Promise<ScoringInputsResult> {
  const anchorMetrics: Record<string, AnchorScoringMetrics> = {};
  const missing: string[] = [];

  const store = tryGetReputationStore();
  if (!store) {
    log.info({ event: 'scoring_inputs.no_store', anchorIds });
    return { anchorMetrics, missing: [...anchorIds] };
  }

  for (const anchorId of anchorIds) {
    const metrics: AnchorScoringMetrics = {};

    try {
      // Reliability and latency come from uptime probes, keyed by domain.
      const domain = domainForAnchor(anchorId);
      if (domain) {
        const samples = await store.queryProbeSamples(domain, { kind: 'uptime' });
        if (samples.length > 0) {
          metrics.reliability = samples.filter((s) => s.reachable).length / samples.length;

          const percentiles = computeLatencyPercentiles(samples);
          if (percentiles) metrics.latencyMs = percentiles.p50Ms;
        }
      }

      // Reputation composite comes from settled outcomes, keyed by anchor id.
      const rows = await store.query({ anchorId });
      const scorecard = buildScorecards(mapOutcomeRows(rows))[30];
      if (scorecard.state === 'ok') {
        metrics.reputationComposite = composite({
          fillRate: scorecard.fillRate,
          slippage: scorecard.slippage.p50,
          settleSeconds: scorecard.settleMs.p50 / 1000,
        });
      }
    } catch (err) {
      // One anchor's missing history must not deny the whole route.
      log.warn({
        event: 'scoring_inputs.anchor_failed',
        anchorId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (Object.keys(metrics).length === 0) {
      missing.push(anchorId);
    } else {
      anchorMetrics[anchorId] = metrics;
    }
  }

  return { anchorMetrics, missing };
}
