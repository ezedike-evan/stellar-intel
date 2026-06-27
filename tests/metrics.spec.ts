import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureMetricsWindow,
  getMetricsSnapshot,
  measureClient,
  recordAnchorLatency,
  recordIntentError,
  recordIntentSuccess,
  resetMetrics,
  startClientTimer,
  MAX_SAMPLES_PER_ANCHOR,
} from '@/lib/metrics';

beforeEach(() => {
  resetMetrics();
});

// ─── Intent counters (#298) ────────────────────────────────────────────────────

describe('intent counters', () => {
  it('reflects correct totals after a handful of intents', () => {
    recordIntentSuccess();
    recordIntentSuccess();
    recordIntentSuccess();
    recordIntentError('NO_ROUTE');
    recordIntentError('VALIDATION_ERROR');
    recordIntentError('NO_ROUTE');

    const snap = getMetricsSnapshot();
    expect(snap.intents.success).toBe(3);
    expect(snap.intents.errorTotal).toBe(3);
    expect(snap.intents.errorByCode).toEqual({ NO_ROUTE: 2, VALIDATION_ERROR: 1 });
  });

  it('resets counters when the configured window elapses', () => {
    const base = 1_000_000;
    configureMetricsWindow(60_000, base);

    recordIntentSuccess(base);
    recordIntentError('NO_ROUTE', base + 1_000);
    expect(getMetricsSnapshot(base + 2_000).intents.success).toBe(1);

    // Past the window: counters roll over to a fresh window.
    const after = getMetricsSnapshot(base + 61_000);
    expect(after.intents.success).toBe(0);
    expect(after.intents.errorTotal).toBe(0);
  });
});

// ─── Per-anchor latency histogram (#299) ───────────────────────────────────────

describe('per-anchor latency', () => {
  it('returns non-trivial p50/p95 after synthetic load', () => {
    for (let ms = 1; ms <= 100; ms++) {
      recordAnchorLatency('cowrie.exchange', ms);
    }

    const summary = getMetricsSnapshot().anchorLatency['cowrie.exchange'];
    expect(summary?.count).toBe(100);
    expect(summary?.p50).toBeGreaterThanOrEqual(49);
    expect(summary?.p50).toBeLessThanOrEqual(51);
    expect(summary?.p95).toBeGreaterThanOrEqual(94);
    expect(summary?.p95).toBeLessThanOrEqual(96);
    expect(summary!.p95).toBeGreaterThan(summary!.p50);
  });

  it('holds open only the last N samples per anchor (ring buffer)', () => {
    for (let i = 0; i < MAX_SAMPLES_PER_ANCHOR + 250; i++) {
      recordAnchorLatency('anchor-a', i);
    }
    expect(getMetricsSnapshot().anchorLatency['anchor-a']?.count).toBe(MAX_SAMPLES_PER_ANCHOR);
  });

  it('ignores invalid samples', () => {
    recordAnchorLatency('anchor-b', -5);
    recordAnchorLatency('anchor-b', Number.NaN);
    expect(getMetricsSnapshot().anchorLatency['anchor-b']).toBeUndefined();
  });
});

// ─── Client timing helper (#297) ───────────────────────────────────────────────

describe('client timing helper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('measures elapsed quote-fetch latency', () => {
    let clock = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);

    const stop = startClientTimer('quote_fetch_latency', { anchorId: 'usdc-ngn' });
    clock = 1_137;
    expect(stop()).toBe(137);
  });

  it('measures tx submit latency around an async op and returns its result', async () => {
    let clock = 5_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);

    const result = await measureClient('tx_submit_latency', async () => {
      clock = 5_420;
      return 'tx-hash';
    });

    expect(result).toBe('tx-hash');
  });
});
