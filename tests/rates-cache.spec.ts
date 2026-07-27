import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { clearRateCache } from '@/lib/api/rate-cache';
import { resetMetrics, getMetricsSnapshot } from '@/lib/metrics';

// Mock the server-side fetcher so the route never touches a real anchor.
const fetchCorridorRatesMock = vi.fn();

vi.mock('@/lib/stellar/server-rates', () => ({
  fetchCorridorRates: (...args: unknown[]) => fetchCorridorRatesMock(...args),
}));

import { GET as getRates } from '@/app/api/rates/[corridor]/route';
import { GET as getMetrics } from '@/app/api/metrics/route';

function makeRequest(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { headers });
}

function callRates(url: string, headers: Record<string, string> = {}) {
  return getRates(makeRequest(url, headers), { params: { corridor: 'usdc-ngn' } });
}

describe('rates endpoint cache hit/miss metrics (#737)', () => {
  beforeEach(() => {
    clearRateCache();
    resetMetrics();
    fetchCorridorRatesMock.mockReset();
    fetchCorridorRatesMock.mockResolvedValue({
      corridorId: 'usdc-ngn',
      rates: [
        {
          anchorId: 'cowrie',
          anchorName: 'Cowrie Exchange',
          corridorId: 'usdc-ngn',
          fee: 2,
          feeType: 'flat',
          exchangeRate: 1580,
          totalReceived: 153660,
          source: 'sep24-fee',
          updatedAt: new Date(),
        },
      ],
      pending: [],
      bestRateId: 'cowrie',
      errors: [],
    });
  });

  it('records a miss on the first request and a hit on the next', async () => {
    const res1 = await callRates('http://localhost/api/rates/usdc-ngn?amount=100');
    expect(res1.status).toBe(200);
    expect(fetchCorridorRatesMock).toHaveBeenCalledTimes(1);
    expect(getMetricsSnapshot().ratesCache).toEqual({ hits: 0, misses: 1 });

    const res2 = await callRates('http://localhost/api/rates/usdc-ngn?amount=100');
    expect(res2.status).toBe(200);
    expect(fetchCorridorRatesMock).toHaveBeenCalledTimes(1); // served from cache
    expect(getMetricsSnapshot().ratesCache).toEqual({ hits: 1, misses: 1 });
  });

  it('exposes the counters through GET /api/metrics', async () => {
    await callRates('http://localhost/api/rates/usdc-ngn?amount=100');
    await callRates('http://localhost/api/rates/usdc-ngn?amount=100');

    const res = await getMetrics(new NextRequest('http://localhost/api/metrics'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ratesCache: { hits: 1, misses: 1 } });
  });

  it('counts a miss and refetches when forceRefresh=true', async () => {
    await callRates('http://localhost/api/rates/usdc-ngn?amount=100');
    await callRates('http://localhost/api/rates/usdc-ngn?amount=100&forceRefresh=true');

    expect(fetchCorridorRatesMock).toHaveBeenCalledTimes(2);
    expect(getMetricsSnapshot().ratesCache).toEqual({ hits: 0, misses: 2 });
  });

  it('counts a miss and refetches for no-cache / no-store / Pragma bypasses', async () => {
    await callRates('http://localhost/api/rates/usdc-ngn?amount=100');

    for (const headers of [
      { 'cache-control': 'no-cache' },
      { 'cache-control': 'no-store' },
      { pragma: 'no-cache' },
    ]) {
      await callRates('http://localhost/api/rates/usdc-ngn?amount=100', headers);
    }

    expect(fetchCorridorRatesMock).toHaveBeenCalledTimes(4);
    expect(getMetricsSnapshot().ratesCache).toEqual({ hits: 0, misses: 4 });
  });
});
