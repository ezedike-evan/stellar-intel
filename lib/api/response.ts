/**
 * lib/api/response.ts
 *
 * Shared response helpers for the public v1 API (#805): a consistent error
 * envelope, standard rate-limit headers, and a version header on every
 * response, so a client never has to special-case one endpoint's shape
 * against another's.
 */

import { NextResponse } from 'next/server';
import type { ApiError } from '@/types';
import {
  checkRateLimit,
  getClientIp,
  type RateLimitOptions,
  type RateLimitResult,
} from './rate-limit';

/**
 * Re-exported so existing importers keep working. Defined in ./api-version so
 * lib/logger.ts can stamp it without importing this module's dependency chain.
 * Full URL-path versioning (e.g. `/v2/...`) is tracked separately as part of
 * the versioning/deprecation policy.
 */
export { API_VERSION } from './api-version';
import { API_VERSION } from './api-version';

/** Sets standard headers every public v1 API response should carry. */
export function withApiHeaders(response: NextResponse): NextResponse {
  response.headers.set('API-Version', API_VERSION);
  return response;
}

/** Sets the standard X-RateLimit-* headers from a checkRateLimit result. */
export function withRateLimitHeaders(response: NextResponse, rl: RateLimitResult): NextResponse {
  response.headers.set('X-RateLimit-Limit', String(rl.limit));
  response.headers.set('X-RateLimit-Remaining', String(rl.remaining));
  response.headers.set('X-RateLimit-Reset', String(Math.ceil(rl.resetAt / 1000)));
  return response;
}

/** Builds the consistent 429 response: ApiError envelope + Retry-After + rate-limit headers. */
export function rateLimitedResponse(rl: RateLimitResult): NextResponse {
  const response = NextResponse.json<ApiError>(
    { code: 'RATE_LIMITED', message: 'Too many requests', retryAfter: rl.retryAfter },
    { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
  );
  return withApiHeaders(withRateLimitHeaders(response, rl));
}

/** Builds a typed ApiError response, stamped with the standard API headers. */
export function apiErrorResponse(error: ApiError, status: number): NextResponse {
  return withApiHeaders(NextResponse.json<ApiError>(error, { status }));
}

/** Wraps a success payload, stamped with the standard API headers. */
export function apiSuccessResponse<T>(data: T, init?: ResponseInit): NextResponse {
  return withApiHeaders(NextResponse.json<T>(data, init));
}

/**
 * Rate-limits a request, returning a ready 429 when over the cap and `null`
 * when the caller should proceed.
 *
 * Exists so adding a limit to a route is two lines rather than a copied block
 * of header-setting — the reason 20 routes went uncovered while the OpenAPI
 * spec described the limit as universal (#733).
 *
 *   const limited = await enforceRateLimit(request, { bucket: 'api.x', maxRequests: 60 });
 *   if (limited) return limited;
 */
export async function enforceRateLimit(
  request: Request,
  options: RateLimitOptions & { bucket: string }
): Promise<NextResponse | null> {
  const rl = await checkRateLimit(getClientIp(request.headers), options);
  return rl.allowed ? null : rateLimitedResponse(rl);
}
