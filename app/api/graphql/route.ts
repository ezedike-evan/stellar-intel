import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';
import { getLogger } from '@/lib/logger';

// This route resolves rates/anchors/health/intent data through the same
// lib/ functions the REST v1 routes use — see lib/graphql/resolvers.ts.
// Additive surface only: REST v1 (public/openapi.json) remains canonical.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type YogaHandler = (request: Request, context: Record<string, unknown>) => Promise<Response>;

/**
 * Yoga is built on first request rather than at module scope.
 *
 * The deployed endpoint returned `HTTP 500` with `content-length: 0` — an empty
 * body, which is what a serverless function that dies during *module
 * evaluation* looks like from outside. A top-level `import { createYoga } from
 * 'graphql-yoga'` puts both the import and the schema build above the handler,
 * so nothing inside this file could observe or report the failure, and the
 * route's own try/catch never ran. Every other route on the deployment was
 * healthy at the same moment (`/api/v1/health`, `/api/metrics`, `/api/snapshot`
 * and the Stellar-SDK-backed `/api/intent/offramp` all answered), which places
 * the fault in loading graphql-yoga itself rather than in this project's code —
 * the same build serves a working `/api/graphql` locally under `next start`.
 *
 * Importing inside the handler means a module-resolution failure arrives as a
 * caught, logged, JSON-shaped error naming the cause, instead of an opaque
 * empty 500. See also `serverExternalPackages` in next.config.ts, which keeps
 * graphql/graphql-yoga out of the bundler and loads them from node_modules at
 * runtime.
 */
let yogaPromise: Promise<YogaHandler> | null = null;

async function getYogaHandler(): Promise<YogaHandler> {
  if (!yogaPromise) {
    yogaPromise = (async () => {
      const { createYoga } = await import('graphql-yoga');
      const { schema } = await import('@/lib/graphql/schema');
      const { createGraphqlSecurityPlugin } = await import('@/lib/graphql/security');

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

      return handleRequest as unknown as YogaHandler;
    })().catch((error: unknown) => {
      // Do not cache a rejected promise: a cold start that failed for a
      // transient reason should be retried by the next request rather than
      // pinning this instance to a permanent 500.
      yogaPromise = null;
      throw error;
    });
  }

  return yogaPromise;
}

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
    const handleRequest = await getYogaHandler();
    return await handleRequest(request, {});
  } catch (error) {
    // Never let a throw — from loading graphql-yoga, building the schema, or
    // executing an operation — surface as a bare empty 500. The message is
    // echoed in the GraphQL error envelope so an operator can read the cause
    // straight off the endpoint; the stack stays in the log only.
    const message = error instanceof Error ? error.message : String(error);
    getLogger('api.graphql').error({
      event: 'graphql_handler_error',
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { errors: [{ message: `Internal server error: ${message}` }] },
      { status: 500 }
    );
  }
}

export { handler as GET, handler as POST };
