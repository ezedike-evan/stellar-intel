import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/graphql/route';
import { checkRateLimit, clearRateLimitStore } from '@/lib/api/rate-limit';

// A valid Stellar public key (USDC issuer on mainnet) — mirrors tests/api-intent.spec.ts.
const VALID_SENDER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

interface GraphQLResponse<T> {
  data: T | null;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
}

function makeRequest(
  query: string,
  variables?: Record<string, unknown>,
  headers?: HeadersInit
): NextRequest {
  return new NextRequest('http://localhost/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ query, variables }),
  });
}

async function run<T>(
  query: string,
  variables?: Record<string, unknown>,
  headers?: HeadersInit
): Promise<GraphQLResponse<T>> {
  const res = await POST(makeRequest(query, variables, headers));
  return (await res.json()) as GraphQLResponse<T>;
}

beforeEach(() => {
  clearRateLimitStore();
});

describe('POST /api/graphql — anchors', () => {
  it('returns every known anchor when corridorId is omitted', async () => {
    const result = await run<{ anchors: Array<{ id: string; degraded: boolean }> }>(
      '{ anchors { id degraded } }'
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.anchors.length).toBeGreaterThan(0);
    expect(result.data?.anchors.every((a) => typeof a.degraded === 'boolean')).toBe(true);
  });

  it('filters anchors by corridorId using the same registry REST uses', async () => {
    const result = await run<{ anchors: Array<{ id: string }> }>(
      'query($c: ID) { anchors(corridorId: $c) { id } }',
      { c: 'usdc-ngn' }
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.anchors.some((a) => a.id === 'cowrie')).toBe(true);
  });

  it('returns null for an unknown anchor id instead of erroring', async () => {
    const result = await run<{ anchor: unknown }>('{ anchor(id: "does-not-exist") { id } }');
    expect(result.errors).toBeUndefined();
    expect(result.data?.anchor).toBeNull();
  });
});

describe('POST /api/graphql — health', () => {
  it('returns publisher, ratesCache and degradedAnchors sections', async () => {
    const result = await run<{
      health: {
        publisher: { lastRun: string | null };
        ratesCache: { hits: number; misses: number };
        degradedAnchors: unknown[];
      };
    }>(
      '{ health { publisher { lastRun } ratesCache { hits misses } degradedAnchors { anchorId } } }'
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.health.ratesCache).toEqual(
      expect.objectContaining({ hits: expect.any(Number), misses: expect.any(Number) })
    );
    expect(Array.isArray(result.data?.health.degradedAnchors)).toBe(true);
  });
});

describe('POST /api/graphql — rates', () => {
  it('resolves a corridor rate comparison, mirroring GET /api/rates/[corridor]', async () => {
    const result = await run<{ rates: { corridorId: string; rates: unknown[] } }>(
      'query($c: ID!) { rates(corridor: $c, amount: "100") { corridorId rates { anchorId source } } }',
      { c: 'usdc-ngn' }
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.rates.corridorId).toBe('usdc-ngn');
  });

  it('returns a BAD_USER_INPUT GraphQL error for an unknown corridor', async () => {
    const result = await run<{ rates: unknown }>(
      'query($c: ID!) { rates(corridor: $c) { corridorId } }',
      { c: 'not-a-corridor' }
    );
    expect(result.data).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  });
});

describe('POST /api/graphql — submitOfframpIntent', () => {
  const MUTATION = `
    mutation($input: OfframpIntentInput!) {
      submitOfframpIntent(input: $input) {
        quoteId
        unsignedTx
        route { anchorId anchorDomain corridorId }
      }
    }
  `;

  const VALID_INPUT = {
    sourceAsset: 'USDC',
    destinationAsset: 'NGN',
    amount: '100',
    sender: VALID_SENDER,
    recipient: 'NGN-BANK-ACCOUNT-123',
  };

  it('resolves the same route and quoteId shape as POST /api/intent/offramp', async () => {
    const result = await run<{
      submitOfframpIntent: { quoteId: string; unsignedTx: string; route: { anchorId: string } };
    }>(MUTATION, { input: VALID_INPUT });

    expect(result.errors).toBeUndefined();
    expect(result.data?.submitOfframpIntent.route.anchorId).toBe('cowrie');
    expect(result.data?.submitOfframpIntent.quoteId).toMatch(/^[0-9a-f]{64}$/);
    expect(result.data?.submitOfframpIntent.unsignedTx.length).toBeGreaterThan(10);
  });

  it('produces a matching quoteId to the REST endpoint for the same intent (shared hashIntent)', async () => {
    const { POST: restPost } = await import('@/app/api/intent/offramp/route');
    const restRes = await restPost(
      new NextRequest('http://localhost/api/intent/offramp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'offramp', ...VALID_INPUT }),
      })
    );
    const restData = (await restRes.json()) as { quoteId: string };

    const result = await run<{ submitOfframpIntent: { quoteId: string } }>(MUTATION, {
      input: VALID_INPUT,
    });

    expect(result.data?.submitOfframpIntent.quoteId).toBe(restData.quoteId);
  });

  it('returns a NO_ROUTE error for an unsupported corridor', async () => {
    const result = await run<{ submitOfframpIntent: unknown }>(MUTATION, {
      input: { ...VALID_INPUT, destinationAsset: 'EUR' },
    });
    expect(result.data).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe('NO_ROUTE');
  });

  it('returns a BAD_USER_INPUT error when amount fails validation', async () => {
    const result = await run<{ submitOfframpIntent: unknown }>(MUTATION, {
      input: { ...VALID_INPUT, amount: 'not-a-number' },
    });
    expect(result.data).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
  });
});

describe('POST /api/graphql — rate limiting', () => {
  it('returns 429 once the api.graphql bucket is exhausted', async () => {
    const ip = '203.0.113.40';
    for (let i = 0; i < 60; i++) {
      await checkRateLimit(ip, { bucket: 'api.graphql', maxRequests: 60 });
    }

    const res = await POST(
      makeRequest('{ health { publisher { lastRun } } }', undefined, {
        'x-forwarded-for': ip,
      })
    );

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });
});
