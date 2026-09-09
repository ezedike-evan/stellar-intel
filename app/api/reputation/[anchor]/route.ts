import { NextRequest, NextResponse } from 'next/server';
import {
  computeCorridorAggregate,
  buildScorecards,
  type SettlementEvent,
  type OutcomeRow,
} from '@/lib/reputation/aggregate';
import { withRequestLogger } from '@/lib/logger';
import { tryGetReputationStore } from '@/lib/reputation/store';
import type { OutcomeLogRow } from '@/types/reputation';
import { enforceRateLimit } from '@/lib/api/response';
import { ANCHORS } from '@/constants/anchors';
import { computeAnchorHealth, type AnchorHealth } from '@/lib/reputation/health';

// ─── In-memory stores (seed / replace with DB in a later iteration) ───────────

const SAMPLE_EVENTS: SettlementEvent[] = [];
const outcomeStore: OutcomeRow[] = [];

/** Exposed for testing and seeding only — not part of the public API surface. */
export function _seedOutcomeStore(rows: OutcomeRow[]): void {
  outcomeStore.length = 0;
  outcomeStore.push(...rows);
}

function toNullableNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toOutcomeRow(row: OutcomeLogRow): OutcomeRow {
  const quotedRate = toNullableNumber(row.quotedRate);
  const deliveredRate = toNullableNumber(row.deliveredRate);
  const slippage =
    quotedRate !== null && deliveredRate !== null && quotedRate !== 0
      ? Math.abs(deliveredRate - quotedRate) / Math.abs(quotedRate)
      : null;
  const recordedAt = Date.parse(row.createdAt);

  return {
    intentHash: row.intentHash,
    anchorId: row.anchorId,
    filled: row.outcome === 'completed',
    settleMs: row.settleSeconds === null ? null : row.settleSeconds * 1000,
    slippage,
    recordedAt: Number.isFinite(recordedAt) ? recordedAt : Date.now(),
  };
}

// ─── GET /api/reputation/[anchor] ────────────────────────────────────────────

/**
 * Two read modes:
 *  - `?corridor=usdc-ngn` → per-corridor 7/30/90-day window aggregates (#171)
 *  - no corridor          → rolling percentile scorecards for the anchor (#132)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ anchor: string }> | { anchor: string } }
): Promise<NextResponse> {
  return withRequestLogger(request, 'api.reputation.anchor', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.reputation.anchor',
      maxRequests: 120,
    });
    if (limited) return limited;

    const { anchor } = await params;

    if (!anchor || typeof anchor !== 'string') {
      logger.warn({ event: 'missing_anchor_param' });
      return NextResponse.json({ error: 'anchor param is required' }, { status: 400 });
    }

    const corridor = new URL(request.url).searchParams.get('corridor');
    logger.info({ event: 'anchor_lookup', anchor, corridor });

    if (corridor) {
      const windows = ([7, 30, 90] as const).map((days) =>
        computeCorridorAggregate(SAMPLE_EVENTS, anchor, corridor, days)
      );
      return NextResponse.json({
        anchorId: anchor,
        corridor,
        windows,
        fetchedAt: new Date().toISOString(),
      });
    }

    // tryGetReputationStore rather than getReputationStore: every sibling read
    // path already uses it, and the throwing variant took this route down at
    // prerender time and in local dev without DATABASE_URL.
    const store = tryGetReputationStore();
    const storedRows = store ? await store.query({ anchorId: anchor }) : [];
    const seededRows = outcomeStore.filter((r) => r.anchorId === anchor);
    const anchorRows = [...seededRows, ...storedRows.map(toOutcomeRow)];

    // Health rides alongside `scorecards`, never inside it. The scorecard is
    // execution-derived and stays exactly as it was; this is the probe record,
    // which is the half that has data today.
    let health: AnchorHealth | null = null;
    if (store) {
      const registered = ANCHORS.find((a) => a.id === anchor);
      if (registered) {
        const domain = registered.serviceDomain ?? registered.homeDomain;
        try {
          const probeRows = await store.queryProbeSamples(domain);
          health = computeAnchorHealth(probeRows, { anchorId: anchor, domain });
        } catch {
          health = null;
        }
      }
    }

    return NextResponse.json({
      anchorId: anchor,
      scorecards: buildScorecards(anchorRows),
      health,
    });
  });
}
