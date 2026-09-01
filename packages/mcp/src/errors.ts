import { OfframpToolError } from '@/lib/mcp/offramp';

/**
 * Typed error taxonomy for MCP tools (#1051).
 *
 * An agent receiving a tool error can inspect `McpToolError.category` to
 * decide how to react without parsing the human-readable message:
 *
 *   BAD_INPUT          — The caller passed invalid arguments.  Do not retry;
 *                        fix the input first.
 *   ANCHOR_UNAVAILABLE — The target anchor exists but is currently down or
 *                        does not support the requested asset/corridor.
 *                        May be worth retrying a different anchor.
 *   UPSTREAM_TIMEOUT   — A network or HTTP error occurred while contacting an
 *                        upstream service.  Transient; safe to retry with
 *                        back-off.
 *   RATE_LIMITED       — The upstream returned 429.  Back off and retry after
 *                        the indicated delay.
 */
export type McpErrorCategory =
  | 'BAD_INPUT'
  | 'ANCHOR_UNAVAILABLE'
  | 'UPSTREAM_TIMEOUT'
  | 'RATE_LIMITED';

export class McpToolError extends Error {
  readonly category: McpErrorCategory;
  /** Optional machine-readable sub-code for finer-grained branching. */
  readonly code: string;

  constructor(message: string, category: McpErrorCategory, code?: string) {
    super(message);
    this.name = 'McpToolError';
    this.category = category;
    this.code = code ?? category;
  }
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

/** Caller supplied an argument that fails validation. */
export function badInput(message: string, code?: string): McpToolError {
  return new McpToolError(message, 'BAD_INPUT', code);
}

/**
 * The anchor exists in the registry but is currently unavailable, degraded,
 * or does not support the requested asset/corridor.
 */
export function anchorUnavailable(message: string, code?: string): McpToolError {
  return new McpToolError(message, 'ANCHOR_UNAVAILABLE', code);
}

/**
 * A network error or non-429 HTTP error occurred while contacting an upstream
 * service.  Treat as transient.
 */
export function upstreamTimeout(message: string, code?: string): McpToolError {
  return new McpToolError(message, 'UPSTREAM_TIMEOUT', code);
}

/** The upstream returned HTTP 429 Too Many Requests. */
export function rateLimited(message: string, code?: string): McpToolError {
  return new McpToolError(message, 'RATE_LIMITED', code);
}

/**
 * Classify a raw HTTP error response into the appropriate `McpToolError`.
 *
 * - 400/422       → BAD_INPUT
 * - 404           → ANCHOR_UNAVAILABLE
 * - 429           → RATE_LIMITED
 * - everything else → UPSTREAM_TIMEOUT
 */
export function fromHttpError(status: number, body: string, context: string): McpToolError {
  if (status === 429) {
    return rateLimited(`${context}: rate limited by upstream (429)`, 'RATE_LIMITED');
  }
  if (status === 404) {
    return anchorUnavailable(`${context}: not found (404) — ${body}`, 'NOT_FOUND');
  }
  if (status === 400 || status === 422) {
    return badInput(`${context}: bad request (${status}) — ${body}`, 'HTTP_BAD_REQUEST');
  }
  return upstreamTimeout(`${context}: upstream error (${status}) — ${body}`, 'HTTP_ERROR');
}

/**
 * Map an OfframpToolError to the appropriate `McpToolError` taxonomy category.
 */
export function fromOfframpError(err: OfframpToolError): McpToolError {
  switch (err.code) {
    case 'NO_ROUTE':
    case 'INTENT_HASH_MISMATCH':
    case 'SIGNATURE_INVALID':
    case 'TX_MISMATCH':
    case 'UNSIGNED_TX':
      return badInput(err.message, err.code);
    case 'RATE_UNAVAILABLE':
      return anchorUnavailable(err.message, err.code);
    case 'TX_BUILD_FAILED':
    case 'SUBMIT_FAILED':
      return upstreamTimeout(err.message, err.code);
    default:
      return upstreamTimeout(err.message, err.code);
  }
}
