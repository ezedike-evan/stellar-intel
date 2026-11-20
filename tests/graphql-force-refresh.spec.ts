import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { resolveCorridorRates } = vi.hoisted(() => ({ resolveCorridorRates: vi.fn() }));

vi.mock('@/lib/api/rates-resolver', () => ({ resolveCorridorRates }));

import { POST } from '@/app/api/graphql/route';
import { clearRateLimitStore } from '@/lib/api/rate-limit';

function post(query: string): NextRequest {
  return new NextRequest('http://localhost/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
}

beforeEach(() => {
  clearRateLimitStore();
  resolveCorridorRates.mockReset();
  resolveCorridorRates.mockResolvedValue({
    comparison: {
      corridorId: 'usdc-ngn',
      rates: [],
      pending: [],
      bestRateId: null,
      errors: [],
    },
  });
});

describe('GraphQL rates(forceRefresh)', () => {
  it('still validates a query that passes forceRefresh', async () => {
    const res = await POST(
      post('{ rates(corridor: "usdc-ngn", forceRefresh: true) { corridorId } }')
    );
    expect(res.status).toBe(200);
  });

  it('never asks the resolver to bypass the shared cache', async () => {
    await POST(post('{ rates(corridor: "usdc-ngn", forceRefresh: true) { corridorId } }'));

    expect(resolveCorridorRates).toHaveBeenCalledTimes(1);
    const options = resolveCorridorRates.mock.calls[0]?.[2] as
      { forceRefresh?: boolean } | undefined;
    expect(options?.forceRefresh ?? false).toBe(false);
  });
});
