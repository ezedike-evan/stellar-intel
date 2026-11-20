import type { NextRequest, NextResponse } from 'next/server';
import { withV1 } from '@/lib/api/v1';
import { tryGetReputationStore } from '@/lib/reputation/store';
import { getAnchorById } from '@/lib/stellar/anchors';

export const runtime = 'nodejs';

const MAX_POINTS = 500;
const DEFAULT_DAYS = 7;
const MIN_DAYS = 1;
const MAX_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PriceHistoryPoint {
  observedAt: string;
  price: string;
  totalPrice: string;
  source: string;
}

/**
 * Keep at most `max` evenly spaced samples; always keep first and last.
 */
export function downsamplePoints<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  if (max <= 1) return points.length ? [points[points.length - 1]!] : [];

  const lastIndex = points.length - 1;
  const result: T[] = [];
  for (let i = 0; i < max; i++) {
    result.push(points[Math.round((i * lastIndex) / (max - 1))]!);
  }
  return result;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  return withV1(request, { bucket: 'v1.anchor.price-history', maxRequests: 60 }, async (ctx) => {
    const { id } = await params;

    let anchor;
    try {
      anchor = getAnchorById(id);
    } catch {
      return ctx.error('not_found', `Unknown anchor: "${id}"`, 404);
    }

    const query = new URL(request.url).searchParams;

    let days = DEFAULT_DAYS;
    const daysRaw = query.get('days');
    if (daysRaw !== null && daysRaw !== '') {
      const parsed = Number(daysRaw);
      if (!Number.isInteger(parsed) || parsed < MIN_DAYS || parsed > MAX_DAYS) {
        return ctx.error(
          'validation_error',
          `days must be an integer between ${MIN_DAYS} and ${MAX_DAYS}`,
          400
        );
      }
      days = parsed;
    }

    const corridorParam = query.get('corridor');
    const corridor = corridorParam || anchor.corridors[0];
    if (!corridor) {
      return ctx.error('validation_error', `Anchor "${id}" has no corridors`, 400);
    }
    if (!anchor.corridors.includes(corridor)) {
      return ctx.error(
        'validation_error',
        `Corridor "${corridor}" is not served by anchor "${id}"`,
        400
      );
    }

    const store = tryGetReputationStore();
    if (!store) {
      return ctx.error('store_unavailable', 'Quote history store is not available', 503);
    }

    let rows;
    try {
      rows = await store.queryQuotes({
        anchorId: id,
        corridor,
        since: new Date(Date.now() - days * DAY_MS),
      });
    } catch {
      return ctx.error('store_unavailable', 'Quote history store is not available', 503);
    }

    const points: PriceHistoryPoint[] = downsamplePoints(
      rows.map((r) => ({
        observedAt: r.observedAt,
        price: r.price,
        totalPrice: r.totalPrice,
        source: r.source,
      })),
      MAX_POINTS
    );

    return {
      status: 200,
      body: { anchorId: id, corridor, points },
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
    };
  });
}
