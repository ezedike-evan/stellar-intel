/**
 * @vitest-environment node
 *
 * Issue #1324 — GET /api/v1/anchors/census.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

const CENSUS = {
  generatedAt: '2026-09-20T00:00:00.000Z',
  sources: ['https://api.stellar.expert/explorer/public/directory?tag[]=anchor&limit=200'],
  counts: { routable: 1, healthOnly: 1, listed: 0, excluded: 0 },
  rows: [
    {
      domain: 'api.cowrie.exchange',
      tier: 'routable',
      seps: { sep6: true, sep24: false, sep31: false, sep38: false, sep10: true },
      withdrawAssets: ['USDC'],
      depositAssets: [],
      receiveAssets: [],
      sources: ['https://api.stellar.expert/explorer/public/directory?tag[]=anchor&limit=200'],
      registeredAnchorId: 'cowrie',
      checkedAt: '2026-09-20T00:00:00.000Z',
    },
    {
      domain: 'healthonly.example',
      tier: 'health-only',
      seps: { sep6: false, sep24: false, sep31: true, sep38: false, sep10: false },
      withdrawAssets: [],
      depositAssets: [],
      receiveAssets: ['USDC'],
      sources: ['https://api.stellar.expert/explorer/public/directory?tag[]=anchor&limit=200'],
      registeredAnchorId: null,
      checkedAt: '2026-09-20T00:00:00.000Z',
    },
  ],
};

vi.mock('@/constants/anchor-census.json', () => ({ default: CENSUS }));

const { GET } = await import('@/app/api/v1/anchors/census/route');

function request(query = '') {
  return new NextRequest(`https://stellar-intel.vercel.app/api/v1/anchors/census${query}`);
}

describe('GET /api/v1/anchors/census', () => {
  it('returns 200 with the full census', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.generatedAt).toBe(CENSUS.generatedAt);
    expect(body.counts).toEqual(CENSUS.counts);
    expect(body.rows).toHaveLength(2);
  });

  it('sets Cache-Control and ETag headers', async () => {
    const response = await GET(request());
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=300, stale-while-revalidate=3600'
    );
    expect(response.headers.get('ETag')).toBe(`"anchor-census-${CENSUS.generatedAt}"`);
  });

  it('filters by tier', async () => {
    const response = await GET(request('?tier=routable'));
    const body = await response.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].domain).toBe('api.cowrie.exchange');
  });

  it('returns 400 with the v1 error envelope for a bogus tier', async () => {
    const response = await GET(request('?tier=bogus'));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('validation_error');
  });
});
