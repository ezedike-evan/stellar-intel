import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ANCHORS, CORRIDORS } from '@/constants';
import type { ApiError } from '@/types';

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
}

export interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  corridor: string | null;
  generatedAt: string;
}

// ─── Stub reputation data ─────────────────────────────────────────────────────
//
// In production this would be sourced from an aggregated outcomes store.
// For now we derive deterministic stub metrics from the anchor registry so
// the endpoint is fully functional and testable without a database.

const STUB_METRICS: Record<
  string,
  { fill_rate: number; settle_p50: number; slippage_p50: number; n: number }
> = {
  moneygram: { fill_rate: 0.97, settle_p50: 42, slippage_p50: 0.003, n: 1240 },
  cowrie: { fill_rate: 0.94, settle_p50: 55, slippage_p50: 0.005, n: 380 },
  anclap: { fill_rate: 0.91, settle_p50: 68, slippage_p50: 0.008, n: 210 },
};

/**
 * Composite score formula (0–1, higher is better):
 *   composite = 0.4 × fill_rate
 *             + 0.3 × (1 − slippage_p50 / 0.05)   // normalised against 5 % ceiling
 *             + 0.3 × (1 − settle_p50 / 300)       // normalised against 5-minute ceiling
 *
 * All terms are clamped to [0, 1] before weighting.
 */
function computeComposite(fill_rate: number, settle_p50: number, slippage_p50: number): number {
  const fillScore = Math.min(1, Math.max(0, fill_rate));
  const slippageScore = Math.min(1, Math.max(0, 1 - slippage_p50 / 0.05));
  const settleScore = Math.min(1, Math.max(0, 1 - settle_p50 / 300));

  const raw = 0.4 * fillScore + 0.3 * slippageScore + 0.3 * settleScore;
  // Round to 4 decimal places to keep the payload compact
  return Math.round(raw * 10_000) / 10_000;
}

function buildLeaderboard(corridorFilter: string | undefined): LeaderboardEntry[] {
  const anchors =
    corridorFilter !== undefined
      ? ANCHORS.filter((a) => a.corridors.includes(corridorFilter))
      : ANCHORS;

  const entries: LeaderboardEntry[] = anchors.map((anchor) => {
    const m = STUB_METRICS[anchor.id] ?? {
      fill_rate: 0.9,
      settle_p50: 90,
      slippage_p50: 0.01,
      n: 50,
    };

    return {
      anchor_id: anchor.id,
      composite: computeComposite(m.fill_rate, m.settle_p50, m.slippage_p50),
      fill_rate: m.fill_rate,
      settle_p50: m.settle_p50,
      slippage_p50: m.slippage_p50,
      n: m.n,
    };
  });

  // Sort descending by composite score
  return entries.sort((a, b) => b.composite - a.composite);
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

const CACHE_MAX_AGE = 60; // seconds

function etagFor(corridor: string | undefined, generatedAt: string): string {
  const key = `${corridor ?? 'all'}:${generatedAt}`;
  // Simple deterministic ETag — not cryptographic, just cache-busting
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (Math.imul(31, hash) + key.charCodeAt(i)) | 0;
  }
  return `"${(hash >>> 0).toString(16)}"`;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;

  const rawParams = {
    corridor: searchParams.get('corridor') ?? undefined,
  };

  const parsed = LeaderboardQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json<ApiError>(
      {
        code: 'VALIDATION_ERROR',
        message: first?.message ?? 'Invalid query parameters',
      },
      { status: 400 }
    );
  }

  const { corridor } = parsed.data;
  const generatedAt = new Date().toISOString();
  const leaderboard = buildLeaderboard(corridor);

  const etag = etagFor(corridor, generatedAt);

  // Honour conditional GET
  if (request.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  const body: LeaderboardResponse = {
    leaderboard,
    corridor: corridor ?? null,
    generatedAt,
  };

  return NextResponse.json<LeaderboardResponse>(body, {
    status: 200,
    headers: {
      'Cache-Control': `public, max-age=${CACHE_MAX_AGE}, s-maxage=${CACHE_MAX_AGE}`,
      ETag: etag,
    },
  });
}
