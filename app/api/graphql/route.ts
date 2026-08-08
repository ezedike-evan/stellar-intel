import { NextRequest, NextResponse } from 'next/server';
import { createYoga } from 'graphql-yoga';
import { schema } from '@/lib/graphql/schema';
import { createGraphqlSecurityPlugin } from '@/lib/graphql/security';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';
import { getLogger } from '@/lib/logger';

// This route resolves rates/anchors/health/intent data through the same
// lib/ functions the REST v1 routes use — see lib/graphql/resolvers.ts.
// Additive surface only: REST v1 (public/openapi.json) remains canonical.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const { handleRequest } = createYoga({
  schema,
  graphqlEndpoint: '/api/graphql',
  // The interactive GraphiQL explorer is a local/staging convenience, not
  // part of the public product surface — off in production.
  landingPage: process.env.NODE_ENV !== 'production',
  // Depth + field-count limits on every operation, and introspection disabled
  // in production (see lib/graphql/security.ts).
  plugins: [createGraphqlSecurityPlugin()],
});

async function handler(request: NextRequest): Promise<Response> {
  const ip = getClientIp(request.headers);
  const rl = await checkRateLimit(ip, { bucket: 'api.graphql', maxRequests: 60 });
  if (!rl.allowed) {
    getLogger('api.graphql').warn({
      event: 'rate_limit_exceeded',
      ip,
      retryAfter: rl.retryAfter,
    });
    return NextResponse.json(
      { error: 'Too many requests', retryAfter: rl.retryAfter },
      {
        status: 429,
        headers: {
          'Retry-After': String(rl.retryAfter),
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  }

  try {
    return await handleRequest(request, {});
  } catch (error) {
    // Never let an unhandled throw surface as a bare empty 500 — return a
    // structured GraphQL-shaped error and log the cause. (The live endpoint has
    // been observed 500ing with an empty body in prod but not locally; the root
    // cause is still unconfirmed and needs a prod-build repro — see maintainer.md
    // Phase 0. This wrapper at least makes any throw observable.)
    getLogger('api.graphql').error({
      event: 'graphql_handler_error',
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ errors: [{ message: 'Internal server error' }] }, { status: 500 });
  }
}

export { handler as GET, handler as POST };
