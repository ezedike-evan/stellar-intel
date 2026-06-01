import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/api/rate-limit';
import { computeCorridorAggregate, type SettlementEvent } from '@/lib/reputation/aggregate';

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
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  const rl = checkRateLimit(ip);
  if (!rl.allowed) {
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
    return new NextResponse(null, { status: 304 });
  }
  lastEtag = etag;

  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      ETag: etag,
      'X-RateLimit-Remaining': String(rl.remaining),
    },
  });
}