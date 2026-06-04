import { NextResponse } from 'next/server';
import { acquireLock, releaseLock } from '@/lib/reputation/lock';
import { withLoggerContext } from '@/lib/logger';

const LOCK_KEY = 'reputation-refresh';
const LOCK_TTL_MS = 5 * 60 * 1000;

let lastRefreshAt: Date | null = null;

export async function POST(): Promise<NextResponse> {
  return withLoggerContext('api.reputation.refresh', async (logger) => {
    if (!acquireLock(LOCK_KEY, LOCK_TTL_MS)) {
      logger.warn({ event: 'refresh_conflict' })
      return NextResponse.json({ error: 'Refresh already in progress' }, { status: 409 })
    }

    try {
      lastRefreshAt = new Date();
      logger.info({ event: 'refresh_completed', refreshedAt: lastRefreshAt.toISOString() })

      return NextResponse.json({
        ok: true,
        refreshedAt: lastRefreshAt.toISOString(),
      })
    } finally {
      releaseLock(LOCK_KEY)
    }
  })
}

export async function GET(): Promise<NextResponse> {
  return withLoggerContext('api.reputation.refresh', async (logger) => {
    logger.info({ event: 'refresh_status_requested', lastRefreshAt: lastRefreshAt?.toISOString() ?? null })
    return NextResponse.json({
      lastRefreshAt: lastRefreshAt?.toISOString() ?? null,
    })
  })
}
