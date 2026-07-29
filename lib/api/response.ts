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
import type { RateLimitResult } from './rate-limit';

/**
 * The public API's version, kept in sync with `info.version` in
 * lib/api/openapi.ts / public/openapi.json. Surfaced on every response as
 * the `API-Version` header so clients can detect a version change without
 * parsing the URL. Full URL-path versioning (e.g. `/v2/...`) is tracked
 * separately as part of the versioning/deprecation policy (epic #808).
 */
export const API_VERSION = '1.3.0';

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
