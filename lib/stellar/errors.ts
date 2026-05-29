// ─── Stable error codes ───────────────────────────────────────────────────────

export const ErrorCode = {
  // Network
  NETWORK_UNREACHABLE: 'NETWORK_UNREACHABLE',
  NETWORK_MISMATCH: 'NETWORK_MISMATCH',
  // Anchor
  ANCHOR_HTTP_ERROR: 'ANCHOR_HTTP_ERROR',
  ANCHOR_INVALID_RESPONSE: 'ANCHOR_INVALID_RESPONSE',
  ANCHOR_RATE_UNAVAILABLE: 'ANCHOR_RATE_UNAVAILABLE',
  // User
  USER_REJECTED: 'USER_REJECTED',
  USER_WALLET_MISSING: 'USER_WALLET_MISSING',
  // Timeout
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

// ─── Root base class ──────────────────────────────────────────────────────────

/**
 * Root base class for all Stellar Intel errors.
 * Carries a stable `code` for exhaustive switch handling.
 */
export abstract class StellarIntelError extends Error {
  abstract readonly code: ErrorCode

  constructor(message: string) {
    super(message)
    // Restore prototype chain for instanceof checks across transpilation targets
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// ─── Subclasses ───────────────────────────────────────────────────────────────

export class NetworkError extends StellarIntelError {
  readonly code: ErrorCode

  constructor(
    message: string,
    code: Extract<ErrorCode, 'NETWORK_UNREACHABLE' | 'NETWORK_MISMATCH'> = ErrorCode.NETWORK_UNREACHABLE
  ) {
    super(message)
    this.name = 'NetworkError'
    this.code = code
  }
}

export class AnchorError extends StellarIntelError {
  readonly code: ErrorCode
  readonly httpStatus: number
  readonly raw: unknown

  constructor(
    message: string,
    code: Extract<ErrorCode, 'ANCHOR_HTTP_ERROR' | 'ANCHOR_INVALID_RESPONSE' | 'ANCHOR_RATE_UNAVAILABLE'> = ErrorCode.ANCHOR_HTTP_ERROR,
    httpStatus = 0,
    raw: unknown = null
  ) {
    super(message)
    this.name = 'AnchorError'
    this.code = code
    this.httpStatus = httpStatus
    this.raw = raw
  }
}

export class UserError extends StellarIntelError {
  readonly code: ErrorCode

  constructor(
    message: string,
    code: Extract<ErrorCode, 'USER_REJECTED' | 'USER_WALLET_MISSING'> = ErrorCode.USER_REJECTED
  ) {
    super(message)
    this.name = 'UserError'
    this.code = code
  }
}

export class TimeoutError extends StellarIntelError {
  readonly code = ErrorCode.REQUEST_TIMEOUT as const

  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

// ─── Type guards ──────────────────────────────────────────────────────────────

export function isStellarIntelError(err: unknown): err is StellarIntelError {
  return err instanceof StellarIntelError
}

export function isNetworkError(err: unknown): err is NetworkError {
  return err instanceof NetworkError
}

export function isAnchorError(err: unknown): err is AnchorError {
  return err instanceof AnchorError
}

export function isUserError(err: unknown): err is UserError {
  return err instanceof UserError
}

export function isTimeoutError(err: unknown): err is TimeoutError {
  return err instanceof TimeoutError
}

// ─── Legacy wallet error hierarchy (preserved for existing consumers) ─────────

/**
 * @deprecated Extend StellarIntelError subclasses instead.
 * Kept for backward compatibility with WalletContext and horizon.ts consumers.
 */
export class WalletError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WalletError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Thrown when the user explicitly rejects a transaction or connection request. */
export class UserRejectedError extends WalletError {
  constructor() {
    super('User rejected the request')
    this.name = 'UserRejectedError'
  }
}

/** Thrown when there is a network mismatch or the horizon server is unreachable. */
export class ConnectionError extends WalletError {
  constructor(message: string) {
    super(message)
    this.name = 'ConnectionError'
  }
}

/** Fallback for unclassified errors. */
export class UnknownWalletError extends WalletError {
  constructor(message: string) {
    super(message)
    this.name = 'UnknownWalletError'
  }
}

// ─── SepError (preserved for existing SEP-24/SEP-10 consumers) ───────────────

/**
 * Thrown when a SEP-24 HTTP request fails. Normalizes all anchor error
 * response formats into a consistent shape.
 */
export class SepError extends Error {
  readonly code: string
  readonly httpStatus: number
  readonly raw: unknown

  constructor(message: string, code: string, httpStatus: number, raw: unknown) {
    super(message)
    this.name = 'SepError'
    this.code = code
    this.httpStatus = httpStatus
    this.raw = raw
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Parses an anchor error response body into a SepError, normalizing the five
 * common formats anchors use: JSON API object, plain string, nested error
 * object, missing/empty fields, and malformed/non-object values.
 */
export function parseSepErrorBody(body: unknown, httpStatus: number): SepError {
  const fallback = `SEP error: HTTP ${httpStatus}`
  let message = fallback
  let code = `HTTP_${httpStatus}`

  if (typeof body === 'string' && body.trim().length > 0) {
    message = body.trim()
  } else if (body !== null && body !== undefined && typeof body === 'object') {
    const obj = body as Record<string, unknown>

    if (typeof obj['error'] === 'string' && obj['error'].trim().length > 0) {
      // JSON API: { error: "...", code?: "..." }
      message = obj['error'].trim()
      if (typeof obj['code'] === 'string' && obj['code'].trim().length > 0) {
        code = obj['code'].trim()
      }
    } else if (obj['error'] !== null && obj['error'] !== undefined && typeof obj['error'] === 'object') {
      // Nested: { error: { message: "...", code?: "..." } }
      const nested = obj['error'] as Record<string, unknown>
      if (typeof nested['message'] === 'string' && nested['message'].trim().length > 0) {
        message = nested['message'].trim()
      }
      if (typeof nested['code'] === 'string' && nested['code'].trim().length > 0) {
        code = nested['code'].trim()
      }
    } else if (typeof obj['detail'] === 'string' && obj['detail'].trim().length > 0) {
      message = obj['detail'].trim()
    } else if (typeof obj['message'] === 'string' && obj['message'].trim().length > 0) {
      message = obj['message'].trim()
    }
  }

  return new SepError(message, code, httpStatus, body)
}
