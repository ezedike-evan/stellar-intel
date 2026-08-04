import { NextRequest, NextResponse } from 'next/server';
import { createYoga } from 'graphql-yoga';
import { schema } from '@/lib/graphql/schema';
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

  return handleRequest(request, {});
}

export { handler as GET, handler as POST };
