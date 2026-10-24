import { NextRequest, NextResponse } from 'next/server';
import { withRequestLogger } from '@/lib/logger';
import {
  getMetricsSnapshot,
  ingestClientSample,
  type ClientMetricName,
  type ClientMetricSample,
} from '@/lib/metrics';
import type { ApiError } from '@/types';
import { enforceRateLimit } from '@/lib/api/response';
import { ANCHORS } from '@/constants/anchors';

export const runtime = 'nodejs';

const CLIENT_METRIC_NAMES: ReadonlySet<ClientMetricName> = new Set([
  'quote_fetch_latency',
  'tx_submit_latency',
]);

/** Beyond this a latency is a timeout or a forgery, not a measurement. */
const MAX_DURATION_MS = 120_000;

function parseSample(body: unknown): ClientMetricSample | null {
  if (typeof body !== 'object' || body === null) return null;
  const { name, durationMs, anchorId } = body as Record<string, unknown>;
  if (typeof name !== 'string' || !CLIENT_METRIC_NAMES.has(name as ClientMetricName)) return null;
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return null;
  if (durationMs > MAX_DURATION_MS) return null;

  // The endpoint is unauthenticated, so an arbitrary anchorId would let a caller
  // grow per-instance memory without bound and poison the latency data that
  // GET /api/metrics and GraphQL `health` serve. Only registry ids are accepted.
  if (anchorId !== undefined && anchorId !== null && anchorId !== '') {
    if (typeof anchorId !== 'string' || !ANCHORS.some((a) => a.id === anchorId)) return null;
    return { name: name as ClientMetricName, durationMs, anchorId };
  }
  return { name: name as ClientMetricName, durationMs };
}

/** Exposes the in-process metrics snapshot (intent counters + per-anchor p50/p95). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.metrics', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.metrics',
      maxRequests: 60,
    });
    if (limited) return limited;

    const snapshot = getMetricsSnapshot();
    logger.info({
      event: 'metrics_snapshot',
      intentSuccess: snapshot.intents.success,
      intentErrors: snapshot.intents.errorTotal,
      anchors: Object.keys(snapshot.anchorLatency).length,
    });
    return NextResponse.json(snapshot);
  });
}

/** Ingests a client-side latency sample (quote fetch / tx submit). */
export async function POST(request: NextRequest): Promise<NextResponse> {
  return withRequestLogger(request, 'api.metrics', async (logger) => {
    const limited = await enforceRateLimit(request, {
      bucket: 'api.metrics.ingest',
      maxRequests: 60,
    });
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const sample = parseSample(body);

    if (!sample) {
      logger.warn({ event: 'metrics_sample_rejected' });
      return NextResponse.json<ApiError>(
        { code: 'VALIDATION_ERROR', message: 'Invalid metric sample' },
        { status: 400 }
      );
    }

    ingestClientSample(sample);
    logger.info({ event: 'metrics_sample', name: sample.name, anchorId: sample.anchorId });
    return NextResponse.json({ ok: true });
  });
}
