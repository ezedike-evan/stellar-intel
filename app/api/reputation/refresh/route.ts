import { NextResponse } from 'next/server';
import { acquireLock, releaseLock } from '@/lib/reputation/lock';

const LOCK_KEY = 'reputation-refresh';
const LOCK_TTL_MS = 5 * 60 * 1000;

let lastRefreshAt: Date | null = null;

export async function POST(): Promise<NextResponse> {
  if (!acquireLock(LOCK_KEY, LOCK_TTL_MS)) {
    return NextResponse.json({ error: 'Refresh already in progress' }, { status: 409 });
  }

  try {
    lastRefreshAt = new Date();
    console.info(`[reputation] aggregate refresh completed at ${lastRefreshAt.toISOString()}`); // eslint-disable-line no-console

    return NextResponse.json({
      ok: true,
      refreshedAt: lastRefreshAt.toISOString(),
    });
  } finally {
    releaseLock(LOCK_KEY);
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    lastRefreshAt: lastRefreshAt?.toISOString() ?? null,
  });
}
