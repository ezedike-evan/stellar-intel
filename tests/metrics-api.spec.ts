import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/metrics/route';
import { recordIntentSuccess, resetMetrics } from '@/lib/metrics';
import { clearRateLimitStore } from '@/lib/api/rate-limit';

beforeEach(() => {
  resetMetrics();
  clearRateLimitStore();
});

function postSample(sample: unknown): NextRequest {
  return new NextRequest('http://localhost/api/metrics', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sample),
  });
}

describe('GET /api/metrics', () => {
  it('exposes the in-process snapshot', async () => {
    recordIntentSuccess();
    const res = await GET(new NextRequest('http://localhost/api/metrics'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.intents.success).toBe(1);
    expect(body).toHaveProperty('anchorLatency');
    expect(res.headers.get('x-correlation-id')).toBeTruthy();
  });
});

describe('POST /api/metrics', () => {
  it('ingests a per-anchor client sample into the histogram', async () => {
    for (let ms = 10; ms <= 30; ms += 10) {
      const res = await POST(
        postSample({ name: 'quote_fetch_latency', durationMs: ms, anchorId: 'cowrie' })
      );
      expect(res.status).toBe(200);
    }

    const snap = await (await GET(new NextRequest('http://localhost/api/metrics'))).json();
    expect(snap.anchorLatency.cowrie.count).toBe(3);
    expect(snap.anchorLatency.cowrie.p50).toBe(20);
  });

  it('rejects an invalid sample', async () => {
    const res = await POST(postSample({ name: 'bogus', durationMs: 'nope' }));
    expect(res.status).toBe(400);
  });

  it('rejects an anchorId that is not in the registry', async () => {
    const res = await POST(
      postSample({ name: 'quote_fetch_latency', durationMs: 10, anchorId: 'not-an-anchor' })
    );
    expect(res.status).toBe(400);

    const snap = await (await GET(new NextRequest('http://localhost/api/metrics'))).json();
    expect(snap.anchorLatency).not.toHaveProperty('not-an-anchor');
  });

  it('accepts a registry anchorId', async () => {
    const res = await POST(
      postSample({ name: 'quote_fetch_latency', durationMs: 10, anchorId: 'cowrie' })
    );
    expect(res.status).toBe(200);
  });

  it('accepts a sample with no anchorId', async () => {
    const res = await POST(postSample({ name: 'tx_submit_latency', durationMs: 10 }));
    expect(res.status).toBe(200);
  });

  it('rejects an implausibly large duration', async () => {
    const res = await POST(
      postSample({ name: 'quote_fetch_latency', durationMs: 500_000, anchorId: 'cowrie' })
    );
    expect(res.status).toBe(400);
  });

  it('rate-limits ingestion: the 61st POST in a window is 429', async () => {
    const sample = { name: 'quote_fetch_latency', durationMs: 10, anchorId: 'cowrie' };
    let last = 200;
    for (let i = 0; i < 61; i += 1) {
      last = (await POST(postSample(sample))).status;
    }
    expect(last).toBe(429);
  });
});
