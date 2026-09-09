import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, type RateLimitResult } from './rate-limit';
import {
  clearIdempotencyStore,
  getIdempotentResponse as getStoredIdempotent,
  readIdempotencyKey,
  storeIdempotentResponse as storeSharedIdempotentResponse,
} from './idempotency';
import { API_VERSION } from './response';

/**
 * lib/api/v1.ts
 *
 * Hardening primitives for the public v1 REST surface (issue #805): a stable
 * `/api/v1/...` namespace with a standard error envelope, rate-limit headers on
 * every response, and idempotency keys on mutating endpoints. Unversioned routes
 * stay internal-only. This is the server-side contract the generated SDK builds
 * on.
 */

/** The stable, documented public API version. */
export const API_V1 = 'v1';

/** Standard v1 error envelope — one shape across every v1 route. */
export interface V1ErrorBody {
  error: { code: string; message: string; requestId: string };
}

/** Builds a v1 error response with the standard envelope. */
export function v1Error(
  code: string,
  message: string,
  requestId: string,
  status: number,
  headers: Record<string, string> = {}
): NextResponse<V1ErrorBody> {
  return NextResponse.json<V1ErrorBody>(
    { error: { code, message, requestId } },
    { status, headers: { 'X-Request-Id': requestId, ...headers } }
  );
}

/**
 * `X-RateLimit-*` headers (and `Retry-After` when throttled) for a v1 response.
 *
 * `X-RateLimit-Reset` is **epoch seconds**, matching `lib/api/response.ts`. It
 * used to be seconds-until-reset here, so the same header name meant two
 * different things depending on which route answered and no client could
 * interpret it without knowing that (#914). `Retry-After` is the header that
 * carries a delta.
 */
export function rateLimitHeaders(limit: number, result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'API-Version': API_VERSION,
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(Math.max(0, result.remaining)),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  };
  if (!result.allowed) headers['Retry-After'] = String(result.retryAfter);
  return headers;
}

// ─── Idempotency ───────────────────────────────────────────────────────────────
//
// Delegates to lib/api/idempotency.ts rather than keeping a second store. Two
// stores meant a retry replayed or re-executed depending on which wrapper the
// route used, and only one of them was ever going to be made durable (#914).

export { readIdempotencyKey, clearIdempotencyStore };

/** A cached response for a previously-seen key, or null. Replays are marked. */
export async function getIdempotentResponse(
  key: string,
  headers: Record<string, string> = {}
): Promise<NextResponse | null> {
  const entry = await getStoredIdempotent(key);
  if (!entry) return null;

  return NextResponse.json(entry.body, {
    status: entry.status,
    headers: { ...headers, 'Idempotency-Replayed': 'true' },
  });
}

export async function storeIdempotentResponse(
  key: string,
  status: number,
  body: unknown
): Promise<void> {
  await storeSharedIdempotentResponse(key, status, body);
}

// ─── Route wrapper ───────────────────────────────────────────────────────────

export interface V1Context {
  requestId: string;
  ip: string;
  /** Build a standard-envelope error result from inside a handler. */
  error(code: string, message: string, status: number): V1HandlerResult;
}

export interface V1HandlerResult {
  status: number;
  body: unknown;
  /**
   * Extra response headers, for routes whose answer has cacheability the
   * wrapper cannot infer (a dated artifact is immutable; today's is not).
   * The hardening headers always win — a handler cannot overwrite the request
   * id or the rate-limit counters.
   */
  headers?: Record<string, string>;
}

export interface V1Options {
  bucket: string;
  maxRequests: number;
  /** Honour the `Idempotency-Key` header (for mutating endpoints). */
  idempotent?: boolean;
}

/**
 * Wraps a v1 handler with the hardening contract: a request id, per-IP rate
 * limiting with `X-RateLimit-*` headers on every response, the standard error
 * envelope (including on throw), and — when `idempotent` — replaying the stored
 * response for a repeated `Idempotency-Key` so a retried request never
 * double-submits.
 */
export async function withV1(
  request: Request,
  options: V1Options,
  handler: (ctx: V1Context) => Promise<V1HandlerResult>
): Promise<NextResponse> {
  const requestId = request.headers.get('x-request-id') ?? globalThis.crypto.randomUUID();
  const ip = getClientIp(request.headers);

  const rl = await checkRateLimit(ip, { bucket: options.bucket, maxRequests: options.maxRequests });
  const baseHeaders = { 'X-Request-Id': requestId, ...rateLimitHeaders(options.maxRequests, rl) };

  if (!rl.allowed) {
    return v1Error('rate_limited', 'Too many requests', requestId, 429, baseHeaders);
  }

  const idempotencyKey = options.idempotent ? readIdempotencyKey(request.headers) : null;
  if (idempotencyKey) {
    const replay = await getIdempotentResponse(idempotencyKey, baseHeaders);
    if (replay) return replay;
  }

  const ctx: V1Context = {
    requestId,
    ip,
    error: (code, message, status) => ({
      status,
      body: { error: { code, message, requestId } },
    }),
  };

  let result: V1HandlerResult;
  try {
    result = await handler(ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return v1Error('internal_error', message, requestId, 500, baseHeaders);
  }

  // Only successful mutations are cached, so a client can safely retry a failure.
  if (idempotencyKey && result.status < 400) {
    await storeIdempotentResponse(idempotencyKey, result.status, result.body);
  }

  return NextResponse.json(result.body, {
    status: result.status,
    headers: { ...result.headers, ...baseHeaders },
  });
}
