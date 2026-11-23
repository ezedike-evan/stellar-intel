import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, type RateLimitResult } from './rate-limit';
import {
  clearIdempotencyStore,
  getIdempotentResponse as getStoredIdempotent,
  readIdempotencyKey,
  scopedIdempotencyKey,
  storeIdempotentResponse as storeSharedIdempotentResponse,
} from './idempotency';
import { API_VERSION } from './response';
import { getLogger } from '@/lib/logger';
import { hasScope, type ApiScope } from '@/lib/auth/api-keys';
import { resolveCaller, type Caller } from '@/lib/auth/caller';
import { recordAuditEvent } from '@/lib/audit/record';
import type { AuditOutcome } from '@/lib/audit/types';

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
  caller: Caller;
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
  /** Intent hash produced by the handler (e.g. quoteId or intentHash) for audit logging. */
  auditIntentHash?: string;
}

export interface V1Options {
  bucket: string;
  maxRequests: number;
  /** Required scope for this endpoint. `null` means "any caller, the handler authorizes itself" and must carry a comment at each use. */
  scope: ApiScope | null;
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

  const recordAudit = (
    callerId: string,
    callerKind: 'anonymous' | 'key' | 'token',
    outcome: AuditOutcome,
    status: number,
    intentHash: string | null = null
  ) => {
    // Which requests are recorded: every request from a key or token caller.
    // For anonymous callers, only requests whose options.scope is not 'quotes:read'
    // (writes and null-scoped routes), plus any denied / rate_limited outcome.
    const shouldRecord =
      callerKind !== 'anonymous' ||
      outcome === 'denied' ||
      outcome === 'rate_limited' ||
      options.scope !== 'quotes:read';

    if (shouldRecord) {
      recordAuditEvent({
        surface: 'rest',
        action: options.bucket,
        scope: options.scope,
        requestId,
        callerId,
        callerKind,
        outcome,
        status,
        intentHash,
      });
    }
  };

  if (!rl.allowed) {
    const callerRes = await resolveCaller(request.headers);
    const caller = callerRes.ok
      ? callerRes.caller
      : { id: 'anonymous', kind: 'anonymous' as const, scopes: [] };
    recordAudit(caller.id, caller.kind, 'rate_limited', 429);
    return v1Error('rate_limited', 'Too many requests', requestId, 429, baseHeaders);
  }

  const callerRes = await resolveCaller(request.headers);
  if (!callerRes.ok) {
    recordAudit('anonymous', 'anonymous', 'denied', callerRes.status);
    return v1Error(callerRes.code, callerRes.message, requestId, callerRes.status, {
      ...baseHeaders,
      'WWW-Authenticate': 'Bearer error="invalid_token"',
    });
  }
  const caller = callerRes.caller;

  if (options.scope && !hasScope(caller.scopes, options.scope)) {
    recordAudit(caller.id, caller.kind, 'denied', 403);
    return v1Error(
      'insufficient_scope',
      `This call needs the "${options.scope}" scope`,
      requestId,
      403,
      {
        ...baseHeaders,
        'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${options.scope}"`,
      }
    );
  }

  // Scoped to this bucket and the exact body, so a key cannot replay another
  // caller's response, or one from a different route or payload. The clone
  // leaves the body unread for the handler.
  const clientKey = options.idempotent ? readIdempotencyKey(request.headers) : null;
  const idempotencyKey = clientKey
    ? await scopedIdempotencyKey(options.bucket, clientKey, await request.clone().text())
    : null;
  if (idempotencyKey) {
    const entry = await getStoredIdempotent(idempotencyKey);
    if (entry) {
      const intentHash =
        typeof entry.body === 'object' && entry.body !== null
          ? ((entry.body as Record<string, unknown>).quoteId as string | undefined) ??
            ((entry.body as Record<string, unknown>).intentHash as string | undefined) ??
            null
          : null;
      recordAudit(caller.id, caller.kind, 'ok', entry.status, intentHash);
      return NextResponse.json(entry.body, {
        status: entry.status,
        headers: { ...baseHeaders, 'Idempotency-Replayed': 'true' },
      });
    }
  }

  const ctx: V1Context = {
    requestId,
    ip,
    caller,
    error: (code, message, status) => ({
      status,
      body: { error: { code, message, requestId } },
    }),
  };

  let result: V1HandlerResult;
  try {
    result = await handler(ctx);
  } catch (err) {
    // The detail stays in the log, keyed by requestId; the caller only gets the
    // envelope, which carries the same requestId for correlation.
    getLogger('api.v1').error({
      event: 'v1_unhandled_error',
      requestId,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    recordAudit(caller.id, caller.kind, 'error', 500);
    return v1Error('internal_error', 'Internal error', requestId, 500, baseHeaders);
  }

  // Only successful mutations are cached, so a client can safely retry a failure.
  if (idempotencyKey && result.status < 400) {
    await storeIdempotentResponse(idempotencyKey, result.status, result.body);
  }

  const outcome: AuditOutcome =
    result.status < 400 ? 'ok' : result.status < 500 ? 'client_error' : 'error';
  recordAudit(caller.id, caller.kind, outcome, result.status, result.auditIntentHash ?? null);

  return NextResponse.json(result.body, {
    status: result.status,
    headers: { ...result.headers, ...baseHeaders },
  });
}
