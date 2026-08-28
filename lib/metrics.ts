// ─── In-process metrics ───────────────────────────────────────────────────────
//
// Lightweight, dependency-free metrics that live in the Node process:
//   • intent success / error-by-code counters over a configurable reset window
//     (Issue #143 / #298)
//   • per-anchor latency samples in a bounded ring buffer, queried as p50 / p95
//     (Issue #144 / #299)
//
// Plus a tiny client-side timing helper (Issue #142 / #297) that wraps the
// Performance API and flushes a sample to GET/POST /api/metrics. All state is
// per-instance and intentionally ephemeral — this is observability, not a store.

const DEFAULT_RESET_WINDOW_MS = Number(process.env.METRICS_RESET_WINDOW_MS) || 60 * 60 * 1000;

/** Hold-open ring buffer size: the last N latency samples per anchor. */
export const MAX_SAMPLES_PER_ANCHOR = 1000;

interface CounterState {
  windowStartedAt: number;
  windowMs: number;
  success: number;
  errorByCode: Map<string, number>;
  ratesCacheHits: number;
  ratesCacheMisses: number;
}

const counters: CounterState = {
  windowStartedAt: Date.now(),
  windowMs: DEFAULT_RESET_WINDOW_MS,
  success: 0,
  errorByCode: new Map(),
  ratesCacheHits: 0,
  ratesCacheMisses: 0,
};

const anchorLatencies = new Map<string, number[]>();

function maybeRollWindow(now: number): void {
  if (now - counters.windowStartedAt >= counters.windowMs) {
    counters.windowStartedAt = now;
    counters.success = 0;
    counters.errorByCode.clear();
    counters.ratesCacheHits = 0;
    counters.ratesCacheMisses = 0;
  }
}

/** Sets the counter reset window (ms) and starts a fresh window. */
export function configureMetricsWindow(windowMs: number, now = Date.now()): void {
  counters.windowMs = windowMs;
  counters.windowStartedAt = now;
  counters.success = 0;
  counters.errorByCode.clear();
  counters.ratesCacheHits = 0;
  counters.ratesCacheMisses = 0;
}

export function recordIntentSuccess(now = Date.now()): void {
  maybeRollWindow(now);
  counters.success += 1;
}

export function recordIntentError(code: string, now = Date.now()): void {
  maybeRollWindow(now);
  counters.errorByCode.set(code, (counters.errorByCode.get(code) ?? 0) + 1);
}

export function recordRatesCacheHit(now = Date.now()): void {
  maybeRollWindow(now);
  counters.ratesCacheHits += 1;
}

export function recordRatesCacheMiss(now = Date.now()): void {
  maybeRollWindow(now);
  counters.ratesCacheMisses += 1;
}

/** Appends a latency sample (ms) for an anchor, evicting the oldest past the cap. */
export function recordAnchorLatency(anchorId: string, latencyMs: number): void {
  if (!anchorId || !Number.isFinite(latencyMs) || latencyMs < 0) return;
  const samples = anchorLatencies.get(anchorId) ?? [];
  samples.push(latencyMs);
  if (samples.length > MAX_SAMPLES_PER_ANCHOR) samples.shift();
  anchorLatencies.set(anchorId, samples);
}

/** Linear-interpolated percentile over an ascending-sorted array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const weight = rank - lo;
  return sorted[lo]! * (1 - weight) + sorted[hi]! * weight;
}

export interface AnchorLatencySummary {
  count: number;
  p50: number;
  p95: number;
}

export interface MetricsSnapshot {
  window: { startedAt: string; windowMs: number };
  intents: { success: number; errorByCode: Record<string, number>; errorTotal: number };
  anchorLatency: Record<string, AnchorLatencySummary>;
  ratesCache: { hits: number; misses: number };
}

export function getMetricsSnapshot(now = Date.now()): MetricsSnapshot {
  maybeRollWindow(now);

  const errorByCode = Object.fromEntries(counters.errorByCode);
  const errorTotal = [...counters.errorByCode.values()].reduce((sum, n) => sum + n, 0);

  const anchorLatency: Record<string, AnchorLatencySummary> = {};
  for (const [anchorId, samples] of anchorLatencies) {
    const sorted = [...samples].sort((a, b) => a - b);
    anchorLatency[anchorId] = {
      count: sorted.length,
      p50: Math.round(percentile(sorted, 50)),
      p95: Math.round(percentile(sorted, 95)),
    };
  }

  return {
    window: {
      startedAt: new Date(counters.windowStartedAt).toISOString(),
      windowMs: counters.windowMs,
    },
    intents: { success: counters.success, errorByCode, errorTotal },
    anchorLatency,
    ratesCache: {
      hits: counters.ratesCacheHits,
      misses: counters.ratesCacheMisses,
    },
  };
}

/** Clears all counters and latency buffers — primarily for tests. */
export function resetMetrics(): void {
  counters.windowStartedAt = Date.now();
  counters.success = 0;
  counters.errorByCode.clear();
  counters.ratesCacheHits = 0;
  counters.ratesCacheMisses = 0;
  anchorLatencies.clear();
}

// ─── Client-side timing helper (Issue #142 / #297) ────────────────────────────

export type ClientMetricName = 'quote_fetch_latency' | 'tx_submit_latency';

export interface ClientMetricSample {
  name: ClientMetricName;
  durationMs: number;
  anchorId?: string;
}

function perf(): Performance | undefined {
  return typeof globalThis.performance !== 'undefined' ? globalThis.performance : undefined;
}

/**
 * Starts a timer and returns a `stop()` that records the elapsed ms, emits a
 * `performance.measure`, flushes the sample, and returns the duration.
 */
export function startClientTimer(
  name: ClientMetricName,
  meta: { anchorId?: string } = {}
): () => number {
  const p = perf();
  const startMark = `${name}:start:${Math.random().toString(16).slice(2)}`;
  const start = p?.now() ?? Date.now();
  p?.mark?.(startMark);

  return () => {
    const durationMs = (p?.now() ?? Date.now()) - start;
    if (p?.measure) {
      try {
        p.measure(name, startMark);
      } catch {
        /* measure is best-effort */
      }
    }
    p?.clearMarks?.(startMark);
    void flushClientMetric({ name, durationMs, ...meta });
    return durationMs;
  };
}

/** Times an async operation, flushes the sample, and returns its result. */
export async function measureClient<T>(
  name: ClientMetricName,
  fn: () => Promise<T>,
  meta: { anchorId?: string } = {}
): Promise<T> {
  const stop = startClientTimer(name, meta);
  try {
    return await fn();
  } finally {
    stop();
  }
}

/** POSTs a client sample to /api/metrics. No-op outside a production browser. */
export function flushClientMetric(sample: ClientMetricSample): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (process.env.NODE_ENV !== 'production') return Promise.resolve();
  return fetch('/api/metrics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sample),
    keepalive: true,
  })
    .then(() => undefined)
    .catch(() => undefined);
}

/** Records a client sample into the in-process store (called by the API route). */
export function ingestClientSample(sample: ClientMetricSample): void {
  if (sample.anchorId) {
    recordAnchorLatency(sample.anchorId, sample.durationMs);
  }
}

// ─── Publisher health tracking ────────────────────────────────────────────────

interface PublisherHealth {
  lastRun: number | null;
  lastBatchSize: number | null;
  lastError: string | null;
}

const publisherHealth: PublisherHealth = {
  lastRun: null,
  lastBatchSize: null,
  lastError: null,
};

export interface PublisherHealthSnapshot {
  lastRun: string | null;
  lastBatchSize: number | null;
  lastError: string | null;
  staleSinceMs: number | null;
}

/** Records a successful publisher run with batch size. */
export function recordPublisherRun(batchSize: number, now = Date.now()): void {
  publisherHealth.lastRun = now;
  publisherHealth.lastBatchSize = batchSize;
  publisherHealth.lastError = null;
}

/** Records a publisher error. */
export function recordPublisherError(error: string, now = Date.now()): void {
  publisherHealth.lastRun = now;
  publisherHealth.lastError = error;
}

/** Returns the current publisher health snapshot. */
export function getPublisherHealth(now = Date.now()): PublisherHealthSnapshot {
  return {
    lastRun: publisherHealth.lastRun ? new Date(publisherHealth.lastRun).toISOString() : null,
    lastBatchSize: publisherHealth.lastBatchSize,
    lastError: publisherHealth.lastError,
    staleSinceMs: publisherHealth.lastRun ? now - publisherHealth.lastRun : null,
  };
}
