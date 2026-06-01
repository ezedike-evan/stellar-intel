import { NextRequest, NextResponse } from 'next/server';
import { computeCorridorAggregate, type SettlementEvent } from '@/lib/reputation/aggregate';

const SAMPLE_EVENTS: SettlementEvent[] = [];

export async function GET(
  request: NextRequest,
  { params }: { params: { anchor: string } }
): Promise<NextResponse> {
  const { anchor } = params;
  const { searchParams } = new URL(request.url);
  const corridor = searchParams.get('corridor');

  if (!corridor) {
    return NextResponse.json({ error: 'corridor query parameter is required' }, { status: 400 });
  }

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
