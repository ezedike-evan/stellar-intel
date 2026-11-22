import { hasScope, type ApiScope, isApiScope } from './api-keys';

export const TOKEN_AUDIENCE = 'stellar-intel';
export const DEFAULT_TOKEN_EXP_SECONDS = 300; // 5 minutes

export interface CallerTokenPayload {
  sub: string;
  scopes: ApiScope[];
  tier?: 'free' | 'pro' | 'partner';
  rateLimit?: number;
  iat?: number;
  exp?: number;
  aud?: string;
  iss?: string;
}

export type VerifyCallerTokenResult =
  | { ok: true; payload: Required<Pick<CallerTokenPayload, 'sub' | 'scopes' | 'iat' | 'exp' | 'aud'>> & CallerTokenPayload }
  | { ok: false; code: 'MALFORMED' | 'EXPIRED' | 'INVALID_SIGNATURE' | 'INVALID_AUDIENCE' | 'MISSING_SECRET'; message: string };

function base64UrlEncode(data: Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof data === 'string') {
    bytes = new TextEncoder().encode(data);
  } else {
    bytes = data;
  }

  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    const b = bytes[i];
    if (b !== undefined) {
      binary += String.fromCharCode(b);
    }
  }

  let b64 = '';
  if (typeof btoa !== 'undefined') {
    b64 = btoa(binary);
  } else if (typeof Buffer !== 'undefined') {
    b64 = Buffer.from(bytes).toString('base64');
  }

  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) {
    b64 += '=';
  }

  let binary = '';
  if (typeof atob !== 'undefined') {
    binary = atob(b64);
  } else if (typeof Buffer !== 'undefined') {
    binary = Buffer.from(b64, 'base64').toString('binary');
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function getTokenSecret(): string {
  const secret = process.env.CALLER_TOKEN_SECRET || process.env.JWT_SECRET;
  if (secret && secret.length > 0) {
    return secret;
  }
  if (process.env.NODE_ENV === 'test') {
    return 'test-caller-token-secret-must-be-long-enough-32bytes';
  }
  return '';
}

export function looksLikeToken(val: string): boolean {
  if (typeof val !== 'string') return false;
  const parts = val.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder().encode(secret);
  return crypto.subtle.importKey(
    'raw',
    enc,
    { name: 'HMAC', hash: { name: 'SHA-256' } },
    false,
    ['sign', 'verify']
  );
}

export async function signCallerToken(
  payload: CallerTokenPayload,
  secretOverride?: string
): Promise<string> {
  const secret = secretOverride ?? getTokenSecret();
  if (!secret) {
    throw new Error('CALLER_TOKEN_SECRET is not configured');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const fullPayload: CallerTokenPayload = {
    ...payload,
    iat: payload.iat ?? now,
    exp: payload.exp ?? now + DEFAULT_TOKEN_EXP_SECONDS,
    aud: payload.aud ?? TOKEN_AUDIENCE,
    iss: payload.iss ?? 'stellar-intel',
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(fullPayload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await getHmacKey(secret);
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingInput)
  );

  const signatureB64 = base64UrlEncode(new Uint8Array(signatureBuffer));
  return `${signingInput}.${signatureB64}`;
}

export async function verifyCallerToken(
  token: string,
  secretOverride?: string
): Promise<VerifyCallerTokenResult> {
  const secret = secretOverride ?? getTokenSecret();
  if (!secret) {
    return {
      ok: false,
      code: 'MISSING_SECRET',
      message: 'Caller token secret is not configured',
    };
  }

  if (!looksLikeToken(token)) {
    return {
      ok: false,
      code: 'MALFORMED',
      message: 'Token is not a well-formed 3-part JWT',
    };
  }

  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return {
      ok: false,
      code: 'MALFORMED',
      message: 'Token is not a well-formed 3-part JWT',
    };
  }

  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  let header: { alg?: string; typ?: string };
  let payload: CallerTokenPayload;
  try {
    const headerStr = new TextDecoder().decode(base64UrlDecode(headerB64));
    const payloadStr = new TextDecoder().decode(base64UrlDecode(payloadB64));
    header = JSON.parse(headerStr);
    payload = JSON.parse(payloadStr);
  } catch {
    return {
      ok: false,
      code: 'MALFORMED',
      message: 'Header or payload cannot be JSON decoded',
    };
  }

  if (header.alg !== 'HS256') {
    return {
      ok: false,
      code: 'MALFORMED',
      message: `Unsupported algorithm: ${header.alg}`,
    };
  }

  const signingInput = `${headerB64}.${payloadB64}`;
  const signatureBytes = base64UrlDecode(signatureB64);
  const key = await getHmacKey(secret);

  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes as unknown as BufferSource,
    new TextEncoder().encode(signingInput) as unknown as BufferSource
  );

  if (!valid) {
    return {
      ok: false,
      code: 'INVALID_SIGNATURE',
      message: 'Token signature verification failed',
    };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) {
    return {
      ok: false,
      code: 'EXPIRED',
      message: `Token expired at ${new Date(payload.exp * 1000).toISOString()}`,
    };
  }

  if (payload.aud && payload.aud !== TOKEN_AUDIENCE) {
    return {
      ok: false,
      code: 'INVALID_AUDIENCE',
      message: `Invalid audience: expected ${TOKEN_AUDIENCE}, got ${payload.aud}`,
    };
  }

  const scopes = Array.isArray(payload.scopes)
    ? payload.scopes.filter(isApiScope)
    : [];

  return {
    ok: true,
    payload: {
      ...payload,
      sub: payload.sub ?? 'anonymous',
      scopes,
      iat: payload.iat ?? now,
      exp: payload.exp ?? now + DEFAULT_TOKEN_EXP_SECONDS,
      aud: payload.aud ?? TOKEN_AUDIENCE,
    },
  };
}

export { hasScope, isApiScope };
