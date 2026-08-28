/**
 * Errors this SDK throws.
 *
 * The v1 surface returns a fixed envelope — `{ error: { code, message,
 * requestId } }`, see `lib/api/v1.ts` — so a caller can branch on `code`
 * rather than parsing prose. Anything that does not carry that envelope is a
 * different class of failure, and gets a different error type, because
 * "the API said NO_ROUTE" and "something between us returned HTML" call for
 * different handling.
 */

export interface ApiErrorBody {
  code: string;
  message: string;
  requestId: string;
}

/** The API returned its structured error envelope. */
export class StellarIntelApiError extends Error {
  override readonly name = 'StellarIntelApiError';
  readonly code: string;
  readonly requestId: string;
  readonly status: number;

  constructor(body: ApiErrorBody, status: number) {
    super(`${body.code}: ${body.message} (HTTP ${status})`);
    this.code = body.code;
    this.requestId = body.requestId;
    this.status = status;
  }
}

/**
 * A non-2xx response with no recognisable envelope.
 *
 * Usually an intermediary — a proxy 502, a platform 503, an HTML error page —
 * rather than the application. `body` carries the first 500 characters so the
 * caller can see what actually came back instead of guessing.
 */
export class StellarIntelResponseError extends Error {
  override readonly name = 'StellarIntelResponseError';
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Unexpected HTTP ${status} with no error envelope`);
    this.status = status;
    this.body = body.slice(0, 500);
  }
}

/** The request never produced a response — network failure, abort, timeout. */
export class StellarIntelNetworkError extends Error {
  override readonly name = 'StellarIntelNetworkError';
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.cause = cause;
  }
}

/** Narrows an unknown parsed body to the v1 error envelope. */
export function isApiErrorBody(value: unknown): value is { error: ApiErrorBody } {
  if (typeof value !== 'object' || value === null) return false;
  const err = (value as { error?: unknown }).error;
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;
  return typeof e['code'] === 'string' && typeof e['message'] === 'string';
}
