import { NextRequest, NextResponse } from 'next/server';
import { GraphQLError, execute, parse, validate, type ExecutionResult } from 'graphql';
import { schema } from '@/lib/graphql/schema';
import { graphqlValidationRules } from '@/lib/graphql/security';
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit';
import { getLogger } from '@/lib/logger';

/**
 * The additive GraphQL surface. Resolves rates/anchors/health/intent data
 * through the same lib/ functions the REST v1 routes use — see
 * lib/graphql/resolvers.ts. REST v1 (public/openapi.json) stays canonical.
 *
 * ─── Why this route does not use graphql-yoga ─────────────────────────────────
 *
 * The deployed endpoint answered `HTTP 500` with `content-length: 0` — an empty
 * body — while every other route on the same deployment was healthy, and the
 * same commit served GraphQL correctly under a local `next start`.
 *
 * Moving `createYoga` off module scope into a lazily-imported, try/caught
 * request path did not fix it, and that failure was informative. A burst of 70
 * requests against the deployed endpoint returned 11 × `429` from the
 * rate-limit check that sits above the yoga call, and 59 × empty `500`. So the
 * route module loads and the handler runs; the process does not survive loading
 * and running yoga, and it fails in a way no `catch` can observe. An empty body
 * is a killed function, not a thrown error.
 *
 * So yoga is gone from the serverless path. Everything it provided here comes
 * directly from `graphql`, which this project already depends on: `parse` →
 * `validate` → `execute` is the whole of it, and the depth, field-count and
 * introspection rules were always ordinary `ValidationRule`s that never needed
 * a plugin host. The public contract is unchanged — POST a
 * `{query, variables, operationName}` body or GET `?query=`, receive
 * `{data, errors}`.
 *
 * The one deliberate loss is the GraphiQL explorer, which was already disabled
 * in production and is a development convenience rather than part of the
 * product.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface GraphQLRequestBody {
  query?: unknown;
  variables?: unknown;
  operationName?: unknown;
}

function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json({ data: null, errors: [{ message }] }, { status });
}

interface ParsedOperation {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}

/** Reads the operation from a POST body or a GET query string. */
async function readOperation(
  request: NextRequest
): Promise<{ ok: true; operation: ParsedOperation } | { ok: false; response: NextResponse }> {
  if (request.method === 'GET') {
    const query = request.nextUrl.searchParams.get('query');
    if (!query) return { ok: false, response: errorResponse('Missing query parameter', 400) };

    const operationName = request.nextUrl.searchParams.get('operationName');
    const rawVariables = request.nextUrl.searchParams.get('variables');

    let variables: Record<string, unknown> | undefined;
    if (rawVariables) {
      try {
        variables = JSON.parse(rawVariables) as Record<string, unknown>;
      } catch {
        return { ok: false, response: errorResponse('variables must be valid JSON', 400) };
      }
    }

    return {
      ok: true,
      operation: {
        query,
        ...(variables ? { variables } : {}),
        ...(operationName ? { operationName } : {}),
      },
    };
  }

  let body: GraphQLRequestBody;
  try {
    body = (await request.json()) as GraphQLRequestBody;
  } catch {
    return { ok: false, response: errorResponse('Request body must be valid JSON', 400) };
  }

  if (typeof body.query !== 'string' || body.query.trim() === '') {
    return { ok: false, response: errorResponse('Missing query field', 400) };
  }

  return {
    ok: true,
    operation: {
      query: body.query,
      ...(body.variables && typeof body.variables === 'object'
        ? { variables: body.variables as Record<string, unknown> }
        : {}),
      ...(typeof body.operationName === 'string' ? { operationName: body.operationName } : {}),
    },
  };
}

function serialiseErrors(errors: readonly GraphQLError[]) {
  return errors.map((error) => ({
    message: error.message,
    ...(error.path ? { path: error.path } : {}),
    ...(error.extensions && Object.keys(error.extensions).length > 0
      ? { extensions: error.extensions }
      : {}),
  }));
}

async function handler(request: NextRequest): Promise<Response> {
  const logger = getLogger('api.graphql');

  const ip = getClientIp(request.headers);
  const rl = await checkRateLimit(ip, { bucket: 'api.graphql', maxRequests: 60 });
  if (!rl.allowed) {
    logger.warn({ event: 'rate_limit_exceeded', ip, retryAfter: rl.retryAfter });
    return NextResponse.json(
      { error: 'Too many requests', retryAfter: rl.retryAfter },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfter), 'X-RateLimit-Remaining': '0' },
      }
    );
  }

  const parsed = await readOperation(request);
  if (!parsed.ok) return parsed.response;
  const { operation } = parsed;

  // Syntax. A malformed query is the caller's error, not ours.
  let document;
  try {
    document = parse(operation.query);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error), 400);
  }

  // Depth, field count, and — in production — no introspection.
  const validationErrors = validate(schema, document, graphqlValidationRules());
  if (validationErrors.length > 0) {
    return NextResponse.json(
      { data: null, errors: serialiseErrors(validationErrors) },
      { status: 400 }
    );
  }

  try {
    const result: ExecutionResult = await execute({
      schema,
      document,
      ...(operation.variables ? { variableValues: operation.variables } : {}),
      ...(operation.operationName ? { operationName: operation.operationName } : {}),
    });

    return NextResponse.json(
      {
        data: result.data ?? null,
        ...(result.errors && result.errors.length > 0
          ? { errors: serialiseErrors(result.errors) }
          : {}),
      },
      { status: 200 }
    );
  } catch (error) {
    // A throw that escaped GraphQL's own error handling. Logged with the stack,
    // reported with the message — never as an empty body, which is what made
    // the original outage undiagnosable from outside.
    const message = error instanceof Error ? error.message : String(error);
    logger.error({
      event: 'graphql_execution_error',
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return errorResponse(`Internal server error: ${message}`, 500);
  }
}

export { handler as GET, handler as POST };
