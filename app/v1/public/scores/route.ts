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

const PAYLOAD_CACHE_MS = 60_000;

let lastEtag = '';
let cachedPayload: ReturnType<typeof computeScorePayload> | null = null;
let cachedAt = 0;

function computeScorePayload() {
  return KNOWN_ANCHORS.map(({ anchorId, corridor }) => ({
    anchorId,
    corridor,
    score30d: computeCorridorAggregate(SAMPLE_EVENTS, anchorId, corridor, 30),
  }));
}

// Cached for PAYLOAD_CACHE_MS so identical requests within the window get a
// stable ETag: computeCorridorAggregate stamps a fresh `lastRefresh` on every
// call, so recomputing per-request made the payload — and therefore the
// ETag — different on every single request, defeating 304 responses.
function buildScorePayload() {
  const now = Date.now();
  if (!cachedPayload || now - cachedAt >= PAYLOAD_CACHE_MS) {
    cachedPayload = computeScorePayload();
    cachedAt = now;
  }
  return cachedPayload;
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
    const payloadHash = Buffer.from(JSON.stringify(payload)).toString('base64');
    const etag = `"${payloadHash}"`;

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