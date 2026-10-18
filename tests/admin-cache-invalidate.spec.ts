import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/admin/cache/invalidate/route';
import { clearRateCache, getCachedRate, setCachedRate } from '@/lib/api/rate-cache';
import type { RateComparison } from '@/types';

const makeRequest = (body: unknown, headers: Record<string, string> = {}) => {
  const req = new NextRequest('http://localhost/api/admin/cache/invalidate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return req;
};

describe('admin cache invalidation endpoint', () => {
  beforeEach(() => {
    clearRateCache();
    process.env.ADMIN_SECRET_KEY = 'secret';
  });

  it('invalidates cache for a given anchor', async () => {
    setCachedRate('usdc-ngn', '100', {
      corridorId: 'usdc-ngn',
      rates: [
        {
          anchorId: 'moneygram',
          anchorName: 'MoneyGram',
          corridorId: 'usdc-ngn',
          fee: null,
          feeType: 'flat',
          exchangeRate: 1600,
          totalReceived: 160000,
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
          source: 'sep38',
        },
      ],
      pending: [],
      bestRateId: 'moneygram',
    });

    expect(getCachedRate('usdc-ngn', '100')).toBeDefined();

    const res = await POST(makeRequest({ anchorId: 'moneygram' }, { 'x-admin-key': 'secret' }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true, anchorId: 'moneygram' });
    expect(getCachedRate('usdc-ngn', '100')).toBeUndefined();
  });

  it('leaves other anchors and corridors untouched when invalidating a specific anchor', async () => {
    setCachedRate('usdc-ngn', '100', {
      corridorId: 'usdc-ngn',
      rates: [
        {
          anchorId: 'moneygram',
          anchorName: 'MoneyGram',
          corridorId: 'usdc-ngn',
          fee: null,
          feeType: 'flat',
          exchangeRate: 1600,
          totalReceived: 160000,
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
          source: 'sep38',
        },
      ],
      pending: [],
      bestRateId: 'moneygram',
    });

    const otherRate: RateComparison = {
      corridorId: 'xlm-usd',
      rates: [
        {
          anchorId: 'yellowcard',
          anchorName: 'YellowCard',
          corridorId: 'xlm-usd',
          fee: null,
          feeType: 'flat',
          exchangeRate: 0.12,
          totalReceived: 6,
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
          source: 'sep38',
        },
      ],
      pending: [],
      bestRateId: 'yellowcard',
    };
    setCachedRate('xlm-usd', '50', otherRate);

    expect(getCachedRate('usdc-ngn', '100')).toBeDefined();
    expect(getCachedRate('xlm-usd', '50')).toEqual(otherRate);

    const res = await POST(makeRequest({ anchorId: 'moneygram' }, { 'x-admin-key': 'secret' }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true, anchorId: 'moneygram' });

    expect(getCachedRate('usdc-ngn', '100')).toBeUndefined();
    expect(getCachedRate('xlm-usd', '50')).toEqual(otherRate);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await POST(makeRequest({ anchorId: 'moneygram' }));

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects invalid payloads', async () => {
    const res = await POST(makeRequest({}, { 'x-admin-key': 'secret' }));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data).toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
