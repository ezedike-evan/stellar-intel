import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/api/rate-limit';
import { computeCorridorAggregate, type SettlementEvent } from '@/lib/reputation/aggregate';
import { withRequestLogger } from '@/lib/logger';

const SAMPLE_EVENTS: SettlementEvent[] = [];

const KNOWN_ANCHORS = [
  { anchorId: 'anchor-bitso', corridor: 'usdc-mxn' },
  { anchorId: 'anchor-anclax', corridor: 'usdc-ngn' },
  { anchorId: 'anchor-cowrie', corridor: 'usdc-ngn' },
];

let lastEtag = '';

function buildScorePayload() {
  return KNOWN_ANCHORS.map(({ anchorId, corridor }) => ({
    anchorId,
    corridor,
    score30d: computeCorridorAggregate(SAMPLE_EVENTS, anchorId, corridor, 30),
  }));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.public.scores', async (logger) => {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      'unknown';

    const rl = checkRateLimit(ip);
    if (!rl.allowed) {
      logger.warn({ event: 'rate_limit_exceeded', ip, retryAfter: rl.retryAfter });
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: rl.retryAfter },
        {
          status: 429,
          headers: {
            'Retry-After': String(rl.retryAfter),
            'X-RateLimit-Remaining': '0',
          },
        }
      );
    }

    const payload = buildScorePayload();
    const etag = `"${Buffer.from(JSON.stringify(payload)).length}-${Date.now()}"`;

    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch && ifNoneMatch === lastEtag) {
      logger.info({ event: 'cache_hit', etag });
      return new NextResponse(null, { status: 304 });
    }
    lastEtag = etag;

    logger.info({ event: 'scores_returned', anchorCount: payload.length });
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
        ETag: etag,
        'X-RateLimit-Remaining': String(rl.remaining),
      },
    });
  })
}