import { isApiScope, type ApiScope } from './api-keys';

// ─── Signed short-lived caller tokens (AGS010) ─────────────────────────────────
//
// Compact HS256 JWS on Web Crypto; no JWT dependency. The algorithm is fixed
// here and never read from the token header, so it cannot be downgraded.

export const TOKEN_AUDIENCE = 'stellar-intel';
export const MAX_TOKEN_TTL_SECONDS = 900;
export const MIN_TOKEN_SECRET_LENGTH = 32;

/** Allowed clock skew for `iat`, in seconds. */
const IAT_SKEW_SECONDS = 30;
const KEY_ID_PATTERN = /^[0-9a-f]{16}$/;
const HEADER = { alg: 'HS256', typ: 'JWT' } as const;

export interface CallerTokenClaims {
  sub: string;
  scp: ApiScope[];
  iat: number;
  exp: number;
  jti: string;
  aud: typeof TOKEN_AUDIENCE;
}

export type TokenVerification =
  | { ok: true; claims: CallerTokenClaims }
  | { ok: false; code: 'malformed_token' | 'bad_signature' | 'token_expired' | 'wrong_audience' };

/** Null when unset or shorter than MIN_TOKEN_SECRET_LENGTH: tokens are then disabled. */
export function getTokenSecret(): string | null {
  const secret = process.env.CALLER_TOKEN_SECRET;
  if (!secret || secret.length < MIN_TOKEN_SECRET_LENGTH) return null;
  return secret;
}

/** Three non-empty dot-separated segments. An `sik_` key never matches. */
export function looksLikeToken(raw: string): boolean {
  const parts = raw.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeJson(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

function importKey(secret: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signCallerToken(
  input: { keyId: string; scopes: ApiScope[]; ttlSeconds: number },
  secret: string,
  now: number = Date.now()
): Promise<string> {
  if (input.ttlSeconds < 1 || input.ttlSeconds > MAX_TOKEN_TTL_SECONDS) {
    throw new RangeError(`ttlSeconds must be between 1 and ${MAX_TOKEN_TTL_SECONDS}`);
  }
  const iat = Math.floor(now / 1000);
  const claims: CallerTokenClaims = {
    sub: input.keyId,
    scp: [...input.scopes],
    iat,
    exp: iat + input.ttlSeconds,
    jti: globalThis.crypto.randomUUID(),
    aud: TOKEN_AUDIENCE,
  };
  const signingInput = `${encodeJson(HEADER)}.${encodeJson(claims)}`;
  const sig = await globalThis.crypto.subtle.sign(
    'HMAC',
    await importKey(secret),
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${Buffer.from(sig).toString('base64url')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function verifyCallerToken(
  token: string,
  secret: string,
  now: number = Date.now()
): Promise<TokenVerification> {
  const malformed = { ok: false, code: 'malformed_token' } as const;

  const parts = token.split('.');
  if (parts.length !== 3) return malformed;
  const [headerSeg, payloadSeg, sigSeg] = parts as [string, string, string];

  const header = decodeJson(headerSeg);
  if (
    !isRecord(header) ||
    Object.keys(header).length !== 2 ||
    header['alg'] !== HEADER.alg ||
    header['typ'] !== HEADER.typ
  ) {
    return malformed;
  }

  const valid = await globalThis.crypto.subtle.verify(
    'HMAC',
    await importKey(secret),
    Buffer.from(sigSeg, 'base64url'),
    new TextEncoder().encode(`${headerSeg}.${payloadSeg}`)
  );
  if (!valid) return { ok: false, code: 'bad_signature' };

  const payload = decodeJson(payloadSeg);
  if (!isRecord(payload)) return malformed;

  const { sub, scp, iat, exp, jti, aud } = payload;
  if (!Number.isInteger(iat) || !Number.isInteger(exp)) return malformed;
  const iatSec = iat as number;
  const expSec = exp as number;
  const nowSec = Math.floor(now / 1000);

  if (expSec <= nowSec) return { ok: false, code: 'token_expired' };
  if (aud !== TOKEN_AUDIENCE) return { ok: false, code: 'wrong_audience' };

  if (
    iatSec > nowSec + IAT_SKEW_SECONDS ||
    expSec - iatSec > MAX_TOKEN_TTL_SECONDS ||
    typeof sub !== 'string' ||
    !KEY_ID_PATTERN.test(sub) ||
    typeof jti !== 'string' ||
    !Array.isArray(scp) ||
    scp.length === 0 ||
    !scp.every(isApiScope)
  ) {
    return malformed;
  }

  return {
    ok: true,
    claims: { sub, scp: [...scp], iat: iatSec, exp: expSec, jti, aud: TOKEN_AUDIENCE },
  };
}
