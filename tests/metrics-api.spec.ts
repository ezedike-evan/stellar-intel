import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/metrics/route';
import { recordIntentSuccess, resetMetrics } from '@/lib/metrics';

beforeEach(() => {
  resetMetrics();
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
        postSample({ name: 'quote_fetch_latency', durationMs: ms, anchorId: 'a1' })
      );
      expect(res.status).toBe(200);
    }

    const snap = await (await GET(new NextRequest('http://localhost/api/metrics'))).json();
    expect(snap.anchorLatency.a1.count).toBe(3);
    expect(snap.anchorLatency.a1.p50).toBe(20);
  });

  it('rejects an invalid sample', async () => {
    const res = await POST(postSample({ name: 'bogus', durationMs: 'nope' }));
    expect(res.status).toBe(400);
  });
});
