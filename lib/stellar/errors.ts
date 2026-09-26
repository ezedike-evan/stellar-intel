/**
 * Stable, exhaustive set of error codes for the StellarIntel error hierarchy.
 * Every {@link StellarIntelError} carries exactly one of these, so consumers can
 * branch on `err.code` with compile-time exhaustiveness.
 */
export enum ErrorCode {
  NETWORK_UNREACHABLE = 'NETWORK_UNREACHABLE',
  NETWORK_MISMATCH = 'NETWORK_MISMATCH',
  ANCHOR_HTTP_ERROR = 'ANCHOR_HTTP_ERROR',
  ANCHOR_INVALID_RESPONSE = 'ANCHOR_INVALID_RESPONSE',
  ANCHOR_RATE_UNAVAILABLE = 'ANCHOR_RATE_UNAVAILABLE',
  USER_REJECTED = 'USER_REJECTED',
  USER_WALLET_MISSING = 'USER_WALLET_MISSING',
  REQUEST_TIMEOUT = 'REQUEST_TIMEOUT',
}

/**
 * Base class for every classified StellarIntel error. Carries a stable
 * {@link ErrorCode} for programmatic branching.
 */
export class StellarIntelError extends Error {
  readonly code: ErrorCode;

  constructor(message: string, code: ErrorCode) {
    super(message);
    this.name = 'StellarIntelError';
    this.code = code;
  }
}

/**
 * Base class for all Stellar-related wallet errors. Part of the
 * {@link StellarIntelError} hierarchy so wallet failures can be branched on by
 * code alongside anchor/network/timeout errors.
 */
export class WalletError extends StellarIntelError {
  constructor(message: string, code: ErrorCode = ErrorCode.USER_REJECTED) {
    super(message, code);
    this.name = 'WalletError';
  }
}

/**
 * Thrown when the user explicitly rejects a transaction or connection request.
 */
export class UserRejectedError extends WalletError {
  constructor() {
    super('User rejected the request', ErrorCode.USER_REJECTED);
    this.name = 'UserRejectedError';
  }
}

/**
 * Thrown when there is a user-side or client error.
 */
export class UserError extends WalletError {
  constructor(message: string, code: ErrorCode = ErrorCode.USER_REJECTED) {
    super(message, code);
    this.name = 'UserError';
  }
}

/**
 * Thrown when there is a network mismatch (e.g. Testnet vs Mainnet)
 * or the horizon server is unreachable.
 */
export class NetworkError extends WalletError {
  constructor(message: string, code: ErrorCode = ErrorCode.NETWORK_UNREACHABLE) {
    super(message, code);
    this.name = 'NetworkError';
  }
}

/**
 * Thrown when the wallet extension is missing, locked, or failing to respond.
 */
export class ConnectionError extends WalletError {
  constructor(message: string) {
    super(message, ErrorCode.USER_WALLET_MISSING);
    this.name = 'ConnectionError';
  }
}

/**
 * Fallback for unclassified errors.
 */
export class UnknownWalletError extends WalletError {
  constructor(message: string) {
    super(message, ErrorCode.USER_REJECTED);
    this.name = 'UnknownWalletError';
  }
}

/**
 * Thrown when an anchor returns an HTTP error or an unusable response. Carries
 * the originating HTTP status and the raw payload for diagnostics.
 */
export class AnchorError extends StellarIntelError {
  readonly httpStatus: number;
  readonly raw: unknown;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.ANCHOR_HTTP_ERROR,
    httpStatus = 0,
    raw: unknown = null
  ) {
    super(message, code);
    this.name = 'AnchorError';
    this.httpStatus = httpStatus;
    this.raw = raw;
  }
}

/**
 * Thrown when an operation exceeds its deadline.
 */
export class TimeoutError extends StellarIntelError {
  constructor(message: string) {
    super(message, ErrorCode.REQUEST_TIMEOUT);
    this.name = 'TimeoutError';
  }
}

/**
 * Thrown when an anchor's stellar.toml does not advertise a TRANSFER_SERVER and
 * therefore cannot be used for the SEP-6 programmatic transfer API. Mirrors the
 * capability assertion used for SEP-38 ({@link AnchorError} hierarchy).
 */
export class Sep6NotSupportedError extends AnchorError {
  readonly domain: string;

  constructor(domain: string) {
    super(
      `Anchor "${domain}" does not advertise TRANSFER_SERVER and cannot be used for SEP-6.`,
      ErrorCode.ANCHOR_INVALID_RESPONSE
    );
    this.name = 'Sep6NotSupportedError';
    this.domain = domain;
  }
}

/** Why a SEP-10 challenge was refused before it reached the wallet. */
export type Sep10ChallengeRejection =
  /** stellar.toml has no usable SIGNING_KEY, so the challenge cannot be authenticated. */
  | 'MISSING_SIGNING_KEY'
  /** WEB_AUTH_ENDPOINT is not an https:// URL. */
  | 'INSECURE_ENDPOINT'
  /** The challenge transaction failed SEP-10 structural or signature checks. */
  | 'INVALID_CHALLENGE'
  /** The challenge asks a different account to sign than the connected wallet. */
  | 'WRONG_ACCOUNT';

/**
 * Thrown when an anchor's SEP-10 challenge fails verification, before anything
 * is handed to the wallet for signing. A challenge that fails these checks may
 * be a real transaction dressed up as a login, so the flow stops here rather
 * than asking the user to judge an opaque XDR blob. The message is written to
 * be shown to the user as-is.
 */
export class Sep10ChallengeRejectedError extends AnchorError {
  readonly domain: string;
  readonly reason: Sep10ChallengeRejection;
  readonly detail: string;

  constructor(domain: string, reason: Sep10ChallengeRejection, detail: string) {
    super(
      `Stopped before signing: the login challenge from "${domain}" failed verification ` +
        `(${detail}). Nothing was sent to your wallet.`,
      ErrorCode.ANCHOR_INVALID_RESPONSE
    );
    this.name = 'Sep10ChallengeRejectedError';
    this.domain = domain;
    this.reason = reason;
    this.detail = detail;
  }
}

// ─── Type guards ──────────────────────────────────────────────────────────────

export function isStellarIntelError(value: unknown): value is StellarIntelError {
  return value instanceof StellarIntelError;
}

export function isNetworkError(value: unknown): value is NetworkError {
  return value instanceof NetworkError;
}

export function isAnchorError(value: unknown): value is AnchorError {
  return value instanceof AnchorError;
}

export function isUserError(value: unknown): value is UserError {
  return value instanceof UserError;
}

export function isTimeoutError(value: unknown): value is TimeoutError {
  return value instanceof TimeoutError;
}

/**
 * Thrown when a SEP-24 HTTP request fails. Normalizes all anchor error
 * response formats into a consistent shape. Intentionally a separate hierarchy
 * from {@link StellarIntelError} (carries a free-form string `code`).
 */
export class SepError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly raw: unknown;

  constructor(message: string, code: string, httpStatus: number, raw: unknown) {
    super(message);
    this.name = 'SepError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.raw = raw;
  }
}

/**
 * Parses an anchor error response body into a SepError, normalizing the five
 * common formats anchors use: JSON API object, plain string, nested error
 * object, missing/empty fields, and malformed/non-object values.
 */
export function parseSepErrorBody(body: unknown, httpStatus: number): SepError {
  const fallback = `SEP error: HTTP ${httpStatus}`;
  let message = fallback;
  let code = `HTTP_${httpStatus}`;

  if (typeof body === 'string' && body.trim().length > 0) {
    message = body.trim();
  } else if (body !== null && body !== undefined && typeof body === 'object') {
    const obj = body as Record<string, unknown>;

    if (typeof obj['error'] === 'string' && obj['error'].trim().length > 0) {
      // JSON API: { error: "...", code?: "..." }
      message = obj['error'].trim();
      if (typeof obj['code'] === 'string' && obj['code'].trim().length > 0) {
        code = obj['code'].trim();
      }
    } else if (
      obj['error'] !== null &&
      obj['error'] !== undefined &&
      typeof obj['error'] === 'object'
    ) {
      // Nested: { error: { message: "...", code?: "..." } }
      const nested = obj['error'] as Record<string, unknown>;
      if (typeof nested['message'] === 'string' && nested['message'].trim().length > 0) {
        message = nested['message'].trim();
      }
      if (typeof nested['code'] === 'string' && nested['code'].trim().length > 0) {
        code = nested['code'].trim();
      }
    } else if (typeof obj['detail'] === 'string' && obj['detail'].trim().length > 0) {
      message = obj['detail'].trim();
    } else if (typeof obj['message'] === 'string' && obj['message'].trim().length > 0) {
      message = obj['message'].trim();
    }
  }

  return new SepError(message, code, httpStatus, body);
}
