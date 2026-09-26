import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ANCHORS, CORRIDORS } from '@/constants';
import { withRequestLogger } from '@/lib/logger';
import { buildScorecards, mapOutcomeRows } from '@/lib/reputation/aggregate';
import { tryGetReputationStore } from '@/lib/reputation/store';
import { getScoreForCorridor, type CorridorScore } from '@/lib/oracle/read';
import type { ApiError } from '@/types';
import { enforceRateLimit } from '@/lib/api/response';
import { weightedComposite } from '@/lib/reputation/composite';
import { loadAnchorHealth, toHealthSummary, type HealthSummary } from '@/lib/reputation/health';

// ─── Query param schema ────────────────────────────────────────────────────────

const validCorridorIds = CORRIDORS.map((c) => c.id) as [string, ...string[]];

const LeaderboardQuerySchema = z.object({
  corridor: z.enum(validCorridorIds).optional(),
});

// ─── Response types ────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  anchor_id: string;
  composite: number;
  fill_rate: number;
  settle_p50: number;
  slippage_p50: number;
  n: number;
  /**
   * The same anchor's score as read live from the reputation oracle contract
   * (testnet) — null when no corridor filter is given (the contract's score
   * is per anchor+corridor, so it's ambiguous without one), the anchor isn't
   * registered on-chain yet, or the read failed. Never blocks the response.
   */
  onChain: CorridorScore | null;
  /**
   * Probe-derived health: what we observed by checking this anchor every five
   * minutes. Separate from every other field on this row, all of which are
   * execution-derived and need settled transactions to mean anything.
   *
   * Null only when no durable store is configured. An anchor with a store but
   * no probes yet reports `state: 'insufficient_data'` with a null score.
   */
  health: HealthSummary | null;
}

export interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  corridor: string | null;
  generatedAt: string;
  /**
   * States plainly where each half of a row comes from, so a consumer cannot
   * read a health number as a reputation number.
   */
  basis: {
    reputation: 'execution-outcomes';
    health: 'probe-observations';
  };
}

/**
 * Composite score formula (0–1, higher is better):
 *   composite = 0.4 × fill_rate
 *             + 0.3 × (1 − slippage_p50 / 0.05)   // normalised against 5 % ceiling
 *             + 0.3 × (1 − settle_p50 / 300)       // normalised against 5-minute ceiling
 *
 * All terms are clamped to [0, 1] before weighting.
 */
async function buildLeaderboard(corridorFilter: string | undefined): Promise<LeaderboardEntry[]> {
  const anchors =
    corridorFilter !== undefined
      ? ANCHORS.filter((a) => a.corridors.includes(corridorFilter))
      : ANCHORS;

  // Null when no durable store is configured (local/dev without DATABASE_URL):
  // every anchor degrades to an empty — not fake — scorecard rather than the
  // whole leaderboard failing. This used to be attempted around `store.query`
  // below, which could never work, because construction throws first.
  const store = tryGetReputationStore();

  // One query for the whole fleet, hoisted out of the per-anchor map below —
  // health is loaded from probe_samples in a single pass rather than once per
  // anchor. Never blocks the leaderboard: a failure here leaves health null and
  // the execution-derived columns unchanged.
  let healthByAnchor = new Map<string, ReturnType<typeof toHealthSummary>>();
  if (store) {
    try {
      const loaded = await loadAnchorHealth(store);
      healthByAnchor = new Map(
        [...loaded].map(([anchorId, health]) => [anchorId, toHealthSummary(health)])
      );
    } catch {
      healthByAnchor = new Map();
    }
  }

  const entries = await Promise.all(
    anchors.map(async (anchor): Promise<LeaderboardEntry> => {
      const rows = store ? await store.query({ anchorId: anchor.id }) : [];

      const scorecard = buildScorecards(mapOutcomeRows(rows))[30];
      const fill_rate = scorecard.state === 'ok' ? scorecard.fillRate : 0;
      const settle_p50 = scorecard.state === 'ok' ? scorecard.settleMs.p50 / 1000 : 0;
      const slippage_p50 = scorecard.state === 'ok' ? scorecard.slippage.p50 : 0;
      const n = scorecard.sampleSize;

      // A scorecard with no real samples yet has nothing to score — report it
      // honestly at the bottom rather than let zeroed inputs read as "perfect"
      // through the composite formula.
      const composite =
        scorecard.state === 'ok' ? weightedComposite(fill_rate, settle_p50, slippage_p50) : 0;

      let onChain: CorridorScore | null = null;
      if (corridorFilter !== undefined) {
        try {
          onChain = await getScoreForCorridor(anchor.id, corridorFilter);
        } catch {
          onChain = null;
        }
      }

      return {
        anchor_id: anchor.id,
        composite,
        fill_rate,
        settle_p50,
        slippage_p50,
        n,
        onChain,
        health: healthByAnchor.get(anchor.id) ?? null,
      };
    })
  );

  // Composite stays the primary sort: execution outcomes decide reputation.
  // Health only breaks ties, which today is the whole table — every anchor
  // scores 0 composite on n=0, and ordering those by observed health is more
  // useful than ordering them by their position in the registry. It is a
  // tiebreak, never a contribution: health cannot move an anchor past one with
  // a real composite score.
  return entries.sort((a, b) => {
    if (b.composite !== a.composite) return b.composite - a.composite;
    return (b.health?.score ?? -1) - (a.health?.score ?? -1);
  });
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

const CACHE_MAX_AGE = 60; // seconds

function etagFor(corridor: string | undefined, leaderboard: LeaderboardEntry[]): string {
  // Derive the ETag from the response content (not a per-request timestamp) so
  // identical data yields a stable ETag and conditional GETs can return 304.
  const key = `${corridor ?? 'all'}:${JSON.stringify(leaderboard)}`;
  // Simple deterministic ETag — not cryptographic, just cache-busting
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (Math.imul(31, hash) + key.charCodeAt(i)) | 0;
  }
  return `"${(hash >>> 0).toString(16)}"`;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.reputation.leaderboard', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.reputation.leaderboard',
      maxRequests: 120,
    });
    if (limited) return limited;

    const { searchParams } = request.nextUrl;

    const rawParams = {
      corridor: searchParams.get('corridor') ?? undefined,
    };

    const parsed = LeaderboardQuerySchema.safeParse(rawParams);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      logger.warn({ event: 'validation_failed', issues: parsed.error.issues });
      return NextResponse.json<ApiError>(
        {
          code: 'VALIDATION_ERROR',
          message: first?.message ?? 'Invalid query parameters',
        },
        { status: 400 }
      );
    }

    const { corridor } = parsed.data;
    logger.info({ event: 'leaderboard_requested', corridor });

    const generatedAt = new Date().toISOString();
    const leaderboard = await buildLeaderboard(corridor);

    const etag = etagFor(corridor, leaderboard);

    // Honour conditional GET
    if (request.headers.get('if-none-match') === etag) {
      logger.info({ event: 'cache_hit', etag });
      return new NextResponse(null, { status: 304, headers: { ETag: etag } });
    }

    const body: LeaderboardResponse = {
      leaderboard,
      corridor: corridor ?? null,
      generatedAt,
      basis: {
        reputation: 'execution-outcomes',
        health: 'probe-observations',
      },
    };

    return NextResponse.json<LeaderboardResponse>(body, {
      status: 200,
      headers: {
        'Cache-Control': `public, max-age=${CACHE_MAX_AGE}, s-maxage=${CACHE_MAX_AGE}`,
        ETag: etag,
      },
    });
  });
}
