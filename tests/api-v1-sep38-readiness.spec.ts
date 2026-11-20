import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sep38Readiness } from '@/lib/stellar/sep38-readiness';

vi.mock('@/lib/api/rate-limit', () => ({
  getClientIp: () => '127.0.0.1',
  checkRateLimit: async () => ({
    allowed: true,
    remaining: 29,
    resetAt: Date.now() + 60_000,
    retryAfter: 0,
  }),
}));

const getAllSep38Readiness = vi.hoisted(() => vi.fn());
vi.mock('@/lib/stellar/sep38-readiness', () => ({ getAllSep38Readiness }));

import { GET } from '@/app/api/v1/sep38/readiness/route';
import {
  SEP38_READINESS_TTL_MS,
  clearSep38ReadinessCache,
  getCachedSep38Readiness,
} from '@/lib/stellar/sep38-readiness-cache';

const ROW: Sep38Readiness = {
  anchorId: 'zeam',
  declared: true,
  quoteServer: 'https://quotes.zeam.example',
  infoReachable: true,
  assets: ['stellar:USDC:GISSUER', 'iso4217:NGN'],
  sellsRegisteredAsset: true,
  error: null,
  checkedAt: '2026-10-25T08:00:00.000Z',
};

const call = () => GET(new Request('http://localhost/api/v1/sep38/readiness') as never);

beforeEach(() => {
  clearSep38ReadinessCache();
  getAllSep38Readiness.mockReset();
  getAllSep38Readiness.mockResolvedValue([ROW]);
});

describe('GET /api/v1/sep38/readiness (#1505)', () => {
  it('returns the anchors with a generatedAt, cacheable for ten minutes', async () => {
    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.anchors).toEqual([ROW]);
    expect(Date.parse(body.generatedAt)).not.toBeNaN();
    expect(res.headers.get('cache-control')).toBe('public, max-age=600');
    expect(res.headers.get('x-ratelimit-limit')).toBe('30');
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('does not re-check the anchors within the TTL', async () => {
    const first = await (await call()).json();
    const second = await (await call()).json();

    expect(getAllSep38Readiness).toHaveBeenCalledTimes(1);
    expect(second.generatedAt).toBe(first.generatedAt);
  });

  it('shares one check between concurrent requests', async () => {
    await Promise.all([call(), call(), call()]);
    expect(getAllSep38Readiness).toHaveBeenCalledTimes(1);
  });

  it('re-checks once the TTL has passed', async () => {
    const start = Date.now();
    await getCachedSep38Readiness(start);
    await getCachedSep38Readiness(start + SEP38_READINESS_TTL_MS - 1);
    expect(getAllSep38Readiness).toHaveBeenCalledTimes(1);

    await getCachedSep38Readiness(start + SEP38_READINESS_TTL_MS + 1);
    expect(getAllSep38Readiness).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed check', async () => {
    getAllSep38Readiness.mockRejectedValueOnce(new Error('boom'));

    const failed = await call();
    expect(failed.status).toBe(500);

    const ok = await call();
    expect(ok.status).toBe(200);
    expect(getAllSep38Readiness).toHaveBeenCalledTimes(2);
  });
});
