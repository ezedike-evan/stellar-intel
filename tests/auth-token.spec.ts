import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'crypto';
import {
  MAX_TOKEN_TTL_SECONDS,
  TOKEN_AUDIENCE,
  getTokenSecret,
  looksLikeToken,
  signCallerToken,
  verifyCallerToken,
} from '@/lib/auth/token';
import { API_KEY_PATTERN } from '@/lib/auth/api-keys';

// AGS010 — signed short-lived caller tokens (HS256 JWS on Web Crypto).

const SECRET = 'a'.repeat(32) + '-caller-token-test-secret';
const KEY_ID = '0123456789abcdef';
const NOW = Date.parse('2026-05-01T12:00:00.000Z');
const NOW_SEC = Math.floor(NOW / 1000);

afterEach(() => {
  vi.unstubAllEnvs();
});

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Hand-sign a token so claims the signer refuses to produce can be tested. */
function handSign(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' },
  secret: string = SECRET
): string {
  const input = `${b64url(header)}.${b64url(payload)}`;
  const sig = createHmac('sha256', secret).update(input).digest('base64url');
  return `${input}.${sig}`;
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: KEY_ID,
    scp: ['quotes:read'],
    iat: NOW_SEC,
    exp: NOW_SEC + 300,
    jti: '9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b',
    aud: TOKEN_AUDIENCE,
    ...overrides,
  };
}

describe('signCallerToken / verifyCallerToken', () => {
  it('round-trips the same claims', async () => {
    const token = await signCallerToken(
      { keyId: KEY_ID, scopes: ['quotes:read', 'intents:write'], ttlSeconds: 600 },
      SECRET,
      NOW
    );

    const result = await verifyCallerToken(token, SECRET, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims).toMatchObject({
      sub: KEY_ID,
      scp: ['quotes:read', 'intents:write'],
      iat: NOW_SEC,
      exp: NOW_SEC + 600,
      aud: TOKEN_AUDIENCE,
    });
    expect(result.claims.jti).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('gives bad_signature when one payload character is flipped', async () => {
    const token = await signCallerToken(
      { keyId: KEY_ID, scopes: ['quotes:read'], ttlSeconds: 60 },
      SECRET,
      NOW
    );
    const [header, payload, sig] = token.split('.') as [string, string, string];
    const flipped = payload.slice(0, 5) + (payload[5] === 'A' ? 'B' : 'A') + payload.slice(6);

    expect(await verifyCallerToken(`${header}.${flipped}.${sig}`, SECRET, NOW)).toEqual({
      ok: false,
      code: 'bad_signature',
    });
  });

  it('gives bad_signature when verified with a different secret', async () => {
    const token = await signCallerToken(
      { keyId: KEY_ID, scopes: ['quotes:read'], ttlSeconds: 60 },
      SECRET,
      NOW
    );
    expect(await verifyCallerToken(token, 'b'.repeat(40), NOW)).toEqual({
      ok: false,
      code: 'bad_signature',
    });
  });

  it('rejects an alg: none token as malformed_token', async () => {
    const token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(claims())}.`;
    expect(await verifyCallerToken(token, SECRET, NOW)).toEqual({
      ok: false,
      code: 'malformed_token',
    });
  });

  it('rejects an HS512 header as malformed_token, even when correctly signed', async () => {
    const token = handSign(claims(), { alg: 'HS512', typ: 'JWT' });
    expect(await verifyCallerToken(token, SECRET, NOW)).toEqual({
      ok: false,
      code: 'malformed_token',
    });
  });

  it('gives token_expired at exactly exp', async () => {
    const token = await signCallerToken(
      { keyId: KEY_ID, scopes: ['quotes:read'], ttlSeconds: 120 },
      SECRET,
      NOW
    );
    expect(await verifyCallerToken(token, SECRET, NOW + 119_000)).toMatchObject({ ok: true });
    expect(await verifyCallerToken(token, SECRET, NOW + 120_000)).toEqual({
      ok: false,
      code: 'token_expired',
    });
  });

  it('throws RangeError for ttlSeconds 901 and 0', async () => {
    await expect(
      signCallerToken(
        { keyId: KEY_ID, scopes: ['quotes:read'], ttlSeconds: MAX_TOKEN_TTL_SECONDS + 1 },
        SECRET,
        NOW
      )
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      signCallerToken({ keyId: KEY_ID, scopes: ['quotes:read'], ttlSeconds: 0 }, SECRET, NOW)
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('gives wrong_audience for another aud', async () => {
    const token = handSign(claims({ aud: 'another-service' }));
    expect(await verifyCallerToken(token, SECRET, NOW)).toEqual({
      ok: false,
      code: 'wrong_audience',
    });
  });

  it('gives malformed_token for an unknown scope in scp', async () => {
    const token = handSign(claims({ scp: ['quotes:read', 'root'] }));
    expect(await verifyCallerToken(token, SECRET, NOW)).toEqual({
      ok: false,
      code: 'malformed_token',
    });
  });

  it('gives malformed_token for an empty scp', async () => {
    const token = handSign(claims({ scp: [] }));
    expect(await verifyCallerToken(token, SECRET, NOW)).toEqual({
      ok: false,
      code: 'malformed_token',
    });
  });

  it('gives malformed_token for an iat 60 s in the future', async () => {
    const token = handSign(claims({ iat: NOW_SEC + 60, exp: NOW_SEC + 360 }));
    expect(await verifyCallerToken(token, SECRET, NOW)).toEqual({
      ok: false,
      code: 'malformed_token',
    });
  });

  it('gives malformed_token for 2 and 4 segments', async () => {
    const token = handSign(claims());
    const [header, payload, sig] = token.split('.') as [string, string, string];

    expect(await verifyCallerToken(`${header}.${payload}`, SECRET, NOW)).toEqual({
      ok: false,
      code: 'malformed_token',
    });
    expect(await verifyCallerToken(`${header}.${payload}.${sig}.${sig}`, SECRET, NOW)).toEqual({
      ok: false,
      code: 'malformed_token',
    });
  });
});

describe('getTokenSecret', () => {
  it('returns null for a 31-character secret', () => {
    vi.stubEnv('CALLER_TOKEN_SECRET', 'x'.repeat(31));
    expect(getTokenSecret()).toBeNull();
  });

  it('returns the value for a 32-character secret', () => {
    vi.stubEnv('CALLER_TOKEN_SECRET', 'x'.repeat(32));
    expect(getTokenSecret()).toBe('x'.repeat(32));
  });

  it('returns null when unset', () => {
    vi.stubEnv('CALLER_TOKEN_SECRET', '');
    expect(getTokenSecret()).toBeNull();
  });
});

describe('looksLikeToken', () => {
  it('is false for an sik_ key', () => {
    const key = `sik_0123456789abcdef_${'Ab3-_x'.repeat(7)}z`;
    expect(key).toMatch(API_KEY_PATTERN);
    expect(looksLikeToken(key)).toBe(false);
  });

  it('is true for three non-empty segments and false otherwise', () => {
    expect(looksLikeToken('a.b.c')).toBe(true);
    expect(looksLikeToken('a.b')).toBe(false);
    expect(looksLikeToken('a..c')).toBe(false);
    expect(looksLikeToken('a.b.c.d')).toBe(false);
  });
});
