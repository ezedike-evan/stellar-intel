import { NextRequest, NextResponse } from 'next/server';
import { acquireLock, releaseLock } from '@/lib/reputation/lock';
import { withLoggerContext } from '@/lib/logger';
import { getReputationStore } from '@/lib/reputation/store';
import {
  DurableProbeStore,
  probeAllAnchors,
  probeAllAnchorQuotes,
  probeAllAnchorIssuers,
  probeAllAnchorIntegrity,
} from '@/lib/reputation/probe';

const LOCK_KEY = 'reputation-refresh';
const LOCK_TTL_MS = 5 * 60 * 1000;

let lastRefreshAt: Date | null = null;

interface ProbeSweepCounts {
  /** Samples that reached the durable ledger. */
  persisted: number;
  /** Samples whose write rejected. Non-zero means the run accumulated less than it probed. */
  failed: number;
  uptime: number;
  quote: number;
  issuerMismatch: number;
  tomlIntegrity: number;
}

// Runs every registered anchor through all four probe dimensions (Issue
// #D007) and persists every sample straight into the durable health ledger
// via `DurableProbeStore`, so a probe run survives past this invocation
// instead of only existing in memory.
async function runProbeSweep(): Promise<ProbeSweepCounts> {
  const store = getReputationStore();
  const uptimeSink = new DurableProbeStore(store, 'uptime');
  const quoteSink = new DurableProbeStore(store, 'quote');
  const issuerSink = new DurableProbeStore(store, 'issuer-mismatch');
  const integritySink = new DurableProbeStore(store, 'toml-integrity');

  const [uptimeSamples, quoteSamples, issuerSamples, integritySamples] = await Promise.all([
    probeAllAnchors(uptimeSink),
    probeAllAnchorQuotes(quoteSink),
    probeAllAnchorIssuers(issuerSink),
    probeAllAnchorIntegrity(integritySink),
  ]);

  const sinks = [uptimeSink, quoteSink, issuerSink, integritySink];
  await Promise.all(sinks.map((sink) => sink.drain()));

  return {
    uptime: uptimeSamples.size,
    quote: quoteSamples.length,
    issuerMismatch: issuerSamples.length,
    tomlIntegrity: integritySamples.length,
    // Counted rather than assumed: `DurableProbeStore.record()` swallows a
    // rejected write, so sample counts above say what was *probed*, not what
    // reached the ledger. Issue #906 was invisible for exactly that reason.
    persisted: sinks.reduce((total, sink) => total + sink.persisted, 0),
    failed: sinks.reduce((total, sink) => total + sink.failed, 0),
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return withLoggerContext('api.reputation.refresh', async (logger) => {
    if (!(await acquireLock(LOCK_KEY, LOCK_TTL_MS))) {
      logger.warn({ event: 'refresh_conflict' });
      return NextResponse.json({ error: 'Refresh already in progress' }, { status: 409 });
    }

    try {
      const probed = await runProbeSweep();

      // A sweep that probed anchors but persisted nothing is a failed sweep, not
      // a successful one — reporting 200 here is how the ledger stayed empty
      // without anyone noticing (Issue #906).
      if (probed.persisted === 0 && probed.failed > 0) {
        logger.error({ event: 'refresh_persist_failed', ...probed });
        return NextResponse.json(
          { ok: false, error: 'Probe sweep persisted no samples', probed },
          { status: 500 }
        );
      }

      lastRefreshAt = new Date();
      logger.info({
        event: 'refresh_completed',
        refreshedAt: lastRefreshAt.toISOString(),
        ...probed,
      });

      return NextResponse.json({
        ok: true,
        refreshedAt: lastRefreshAt.toISOString(),
        probed,
      });
    } finally {
      await releaseLock(LOCK_KEY);
    }
  });
}

export async function GET(): Promise<NextResponse> {
  return withLoggerContext('api.reputation.refresh', async (logger) => {
    logger.info({
      event: 'refresh_status_requested',
      lastRefreshAt: lastRefreshAt?.toISOString() ?? null,
    });
    return NextResponse.json({
      lastRefreshAt: lastRefreshAt?.toISOString() ?? null,
    });
  });
}
