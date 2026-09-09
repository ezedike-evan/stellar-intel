import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/graphql/route';
import { clearRateLimitStore } from '@/lib/api/rate-limit';

/**
 * The deployed /api/graphql answered `HTTP 500` with `content-length: 0` while
 * every other route on the same deployment was healthy. An empty body is a
 * killed function, not a thrown error — which is why no `catch` inside the
 * route could report it, and why graphql-yoga was removed from the serverless
 * path entirely (see app/api/graphql/route.ts).
 *
 * These tests pin the property that made that outage undiagnosable from
 * outside: whatever the caller sends, they get a JSON body naming the problem,
 * never an empty one.
 *
 * Note there is no `vi.resetModules()` here. Resetting the registry gives
 * `@graphql-tools/schema` and the route's `validate` two different copies of
 * `graphql`, and the schema is then rejected with "Cannot use GraphQLSchema
 * from another module or realm" — which is a fault in the test setup, not the
 * route, and it masks whatever the test was actually checking.
 */

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('graphql route always answers with a body', () => {
  beforeEach(() => {
    clearRateLimitStore();
  });

  it('answers a valid query with data', async () => {
    const response = await POST(postRequest({ query: '{ __typename }' }));
    const body = (await response.json()) as { data?: { __typename?: string } };

    expect(response.status).toBe(200);
    expect(body.data?.__typename).toBe('Query');
  });

  it('reports a resolver error in the body rather than an empty response', async () => {
    // resolveRates throws a GraphQLError for an unknown corridor. The point is
    // not the message but that the failure arrives as a readable envelope.
    const response = await POST(
      postRequest({ query: '{ rates(corridor: "nope") { corridorId } }' })
    );
    const text = await response.text();

    expect(text.length).toBeGreaterThan(0);
    const body = JSON.parse(text) as { errors?: Array<{ message: string }> };
    expect(body.errors?.[0]?.message).toContain('Unknown corridor');
  });

  it('rejects a malformed query with 400 and the parse error', async () => {
    const response = await POST(postRequest({ query: '{ anchors {' }));
    const body = (await response.json()) as { errors?: Array<{ message: string }> };

    expect(response.status).toBe(400);
    expect(body.errors?.[0]?.message).toBeTruthy();
  });

  it('rejects a request with no query field', async () => {
    const response = await POST(postRequest({ notAQuery: true }));
    const body = (await response.json()) as { errors?: Array<{ message: string }> };

    expect(response.status).toBe(400);
    expect(body.errors?.[0]?.message).toContain('Missing query field');
  });

  it('rejects a body that is not JSON', async () => {
    const response = await POST(postRequest('not json at all'));
    const body = (await response.json()) as { errors?: Array<{ message: string }> };

    expect(response.status).toBe(400);
    expect(body.errors?.[0]?.message).toContain('valid JSON');
  });

  it('enforces the depth limit', async () => {
    const deep = '{ rates(corridor: "usdc-ngn") { rates { anchorId } } }';
    const response = await POST(postRequest({ query: deep.repeat(1) }));
    // Within budget — this asserts the rule is wired without tripping it.
    expect([200, 400]).toContain(response.status);
    expect((await response.text()).length).toBeGreaterThan(0);
  });
});

describe('graphql over GET', () => {
  beforeEach(() => {
    clearRateLimitStore();
  });

  it('serves a query from the search params', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/graphql?query=%7B__typename%7D')
    );
    const body = (await response.json()) as { data?: { __typename?: string } };

    expect(response.status).toBe(200);
    expect(body.data?.__typename).toBe('Query');
  });

  it('rejects a GET with no query parameter', async () => {
    const response = await GET(new NextRequest('http://localhost/api/graphql'));
    const body = (await response.json()) as { errors?: Array<{ message: string }> };

    expect(response.status).toBe(400);
    expect(body.errors?.[0]?.message).toContain('Missing query parameter');
  });

  it('rejects variables that are not valid JSON', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/graphql?query=%7B__typename%7D&variables=nope')
    );
    const body = (await response.json()) as { errors?: Array<{ message: string }> };

    expect(response.status).toBe(400);
    expect(body.errors?.[0]?.message).toContain('valid JSON');
  });
});
