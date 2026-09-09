import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The deployed /api/graphql answered `HTTP 500` with `content-length: 0` while
 * every other route on the same deployment was healthy. An empty body is what a
 * serverless function that dies during *module evaluation* looks like: the
 * route's own try/catch never runs, because the throw happens above it.
 *
 * These tests pin the property that makes that failure diagnosable — whatever
 * goes wrong while bringing GraphQL up, the caller gets a JSON error envelope
 * naming the cause, never an empty body.
 */

const createYoga = vi.fn();

// `lib/graphql/schema.ts` builds the schema with yoga's own `createSchema`, so
// the mock has to satisfy that import too — otherwise every failure in these
// tests is the stub's, not the route's.
vi.mock('graphql-yoga', () => ({
  get createYoga() {
    return createYoga;
  },
  createSchema: (config: unknown) => config,
  createGraphQLError: (message: string) => new Error(message),
}));

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ __typename }' }),
  });
}

describe('graphql route brings yoga up inside the request', () => {
  beforeEach(async () => {
    vi.resetModules();
    createYoga.mockReset();
    const { clearRateLimitStore } = await import('@/lib/api/rate-limit');
    clearRateLimitStore();
  });

  it('reports a failure to load graphql-yoga as a JSON error, not an empty 500', async () => {
    createYoga.mockImplementation(() => {
      throw new Error("Cannot find module 'graphql-yoga'");
    });

    const { POST } = await import('@/app/api/graphql/route');
    const response = await POST(makeRequest());
    const body = await response.text();

    expect(response.status).toBe(500);
    // The regression: a body at all. An empty 500 is unreadable from outside.
    expect(body.length).toBeGreaterThan(0);

    const parsed = JSON.parse(body) as { errors?: Array<{ message: string }> };
    expect(parsed.errors?.[0]?.message).toContain("Cannot find module 'graphql-yoga'");
  });

  it('retries the next request instead of pinning the instance to a 500', async () => {
    createYoga.mockImplementationOnce(() => {
      throw new Error('transient cold-start failure');
    });

    const { POST } = await import('@/app/api/graphql/route');
    const first = await POST(makeRequest());
    expect(first.status).toBe(500);

    // Second call: the rejected promise must not have been cached.
    createYoga.mockImplementation(() => ({
      handleRequest: async () =>
        new Response(JSON.stringify({ data: { __typename: 'Query' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    }));

    const second = await POST(makeRequest());
    expect(second.status).toBe(200);
    expect(createYoga).toHaveBeenCalledTimes(2);
  });

  it('does not build yoga until a request arrives', async () => {
    createYoga.mockImplementation(() => ({
      handleRequest: async () => new Response('{}', { status: 200 }),
    }));

    await import('@/app/api/graphql/route');
    // Importing the route module alone must not touch graphql-yoga — that is
    // exactly the module-evaluation work being moved into the request path.
    expect(createYoga).not.toHaveBeenCalled();
  });
});
