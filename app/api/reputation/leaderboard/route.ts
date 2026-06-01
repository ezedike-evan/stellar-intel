import { NextResponse } from 'next/server';
import { buildLeaderboardData } from '@/lib/reputation';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const corridor = url.searchParams.get('corridor') ?? undefined;
  const sort = url.searchParams.get('sort') ?? undefined;
  const direction = url.searchParams.get('direction') ?? undefined;

  const leaderboard = buildLeaderboardData(corridor, sort, direction);
  return NextResponse.json(leaderboard);
}
