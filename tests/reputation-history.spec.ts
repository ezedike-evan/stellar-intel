import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, _seedOutcomeStore } from '@/app/api/reputation/[anchor]/history/route';
import { getHistoryBuckets, HistoryResponseSchema } from '@/lib/reputation/buckets';
import type { OutcomeRow } from '@/lib/reputation/aggregate';

const NOW = Date.parse('2026-06-04T12:00:00.000Z');
const hoursAgo = (h: number) => NOW - h * 3_600_000;

function row(over: Partial<OutcomeRow> = {}): OutcomeRow {
  return {
    intentHash: Math.random().toString(16).slice(2),
    anchorId: 'cowrie',
    filled: true,
    settleMs: 2_000,
    slippage: 0.01,
    recordedAt: hoursAgo(1),
    ...over,
  };
}

function historyRequest(anchor: string, window?: string): NextRequest {
  const url = new URL(`http://localhost/api/reputation/${anchor}/history`);
  if (window) url.searchParams.set('window', window);
  return new NextRequest(url);
}

beforeEach(() => {
  _seedOutcomeStore([]);
});

describe('getHistoryBuckets', () => {
  it('buckets rows within the window and reports non-trivial stats', () => {
    const rows: OutcomeRow[] = [
      row({ recordedAt: hoursAgo(1), filled: true, settleMs: 1_000 }),
      row({ recordedAt: hoursAgo(2), filled: false, settleMs: null }),
      row({ recordedAt: hoursAgo(30), filled: true, settleMs: 5_000 }),
    ];

    const result = getHistoryBuckets('cowrie', '7d', rows, NOW);

    expect(result.anchorId).toBe('cowrie');
    expect(result.window).toBe('7d');
    expect(result.buckets.length).toBeGreaterThan(0);
    const totalSamples = result.buckets.reduce((n, b) => n + b.sampleCount, 0);
    expect(totalSamples).toBe(3);
  });

  it('excludes rows for other anchors and rows older than the window', () => {
    const rows: OutcomeRow[] = [
      row({ anchorId: 'moneygram', recordedAt: hoursAgo(1) }),
      row({ recordedAt: hoursAgo(7 * 24 + 5) }), // older than 7d window
    ];
    const result = getHistoryBuckets('cowrie', '7d', rows, NOW);
    expect(result.buckets.reduce((n, b) => n + b.sampleCount, 0)).toBe(0);
  });
});

describe('GET /api/reputation/[anchor]/history', () => {
  it('returns a schema-valid bucketed history for a known anchor', async () => {
    _seedOutcomeStore([row({ recordedAt: hoursAgo(1) }), row({ recordedAt: hoursAgo(3) })]);

    const res = await GET(historyRequest('cowrie', '7d'), { params: { anchor: 'cowrie' } });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(() => HistoryResponseSchema.parse(body)).not.toThrow();
    expect(body.window).toBe('7d');
    expect(body.buckets.reduce((n: number, b: { sampleCount: number }) => n + b.sampleCount, 0)).toBe(2);
  });

  it('defaults to the 30d window when none is supplied', async () => {
    const res = await GET(historyRequest('cowrie'), { params: { anchor: 'cowrie' } });
    expect(res.status).toBe(200);
    expect((await res.json()).window).toBe('30d');
  });

  it('404s for an unknown anchor', async () => {
    const res = await GET(historyRequest('not-an-anchor', '7d'), {
      params: { anchor: 'not-an-anchor' },
    });
    expect(res.status).toBe(404);
  });

  it('400s for an invalid window', async () => {
    const res = await GET(historyRequest('cowrie', '5d'), { params: { anchor: 'cowrie' } });
    expect(res.status).toBe(400);
  });
});
