import { NextRequest, NextResponse } from 'next/server';
import { withLoggerContext } from '@/lib/logger';
import { acquireLock, releaseLock } from '@/lib/reputation/lock';

export const runtime = 'nodejs';
// Fluid Compute: allow the function to run for up to 5 minutes per tick so a
// large pending batch is not cut short by the default 10-second timeout.
export const maxDuration = 300;

const LOCK_KEY = 'publisher-tick';
const LOCK_TTL_MS = 5 * 60 * 1_000;

async function tick(): Promise<{ submitted: number; skipped: number; txHash: string | null }> {
  // Delegates to @stellarintel/publisher once the package ships a built artifact
  // and the Soroban oracle contract is deployed to mainnet (Wave 2.1).
  // Until then, the lock + scheduling scaffolding is live so the cron wires up
  // correctly and missed runs resume cleanly on the next tick.
  return { submitted: 0, skipped: 0, txHash: null };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return withLoggerContext('api.publisher.tick', async (logger) => {
    if (!acquireLock(LOCK_KEY, LOCK_TTL_MS)) {
      logger.warn({ event: 'publisher_tick_conflict' });
      return NextResponse.json({ error: 'Publisher tick already in progress' }, { status: 409 });
    }

    try {
      const result = await tick();
      logger.info({ event: 'publisher_tick_complete', ...result });
      return NextResponse.json({ ok: true, ...result, tickedAt: new Date().toISOString() });
    } finally {
      releaseLock(LOCK_KEY);
    }
  });
}

export const POST = GET;
