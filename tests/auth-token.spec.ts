import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  getTokenSecret,
  looksLikeToken,
  signCallerToken,
  TOKEN_AUDIENCE,
  verifyCallerToken,
} from '@/lib/auth/token';

const SECRET = 'x'.repeat(32);
const NOW = Date.UTC(2026, 0, 1);
const NOW_SEC = NOW / 1000;
const KEY_ID = '0123456789abcdef';

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

/** Hand-signs arbitrary header/payload with HS256, bypassing signCallerToken's checks. */
function handSign(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' },
  secret = SECRET
): string {
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: KEY_ID,
    scp: ['quotes:read'],
    iat: NOW_SEC,
    exp: NOW_SEC + 600,
    jti: 'jti-1',
    aud: TOKEN_AUDIENCE,
    ...overrides,
  };
}

afterEach(() => vi.unstubAllEnvs());

describe('signCallerToken / verifyCallerToken', () => {
  it('round-trips the claims', async () => {
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

  it('a hand-signed token verifies, so the helper matches the implementation', async () => {
    expect((await verifyCallerToken(handSign(claims()), SECRET, NOW)).ok).toBe(true);
  });

  it('gives bad_signature for a tampered payload or another secret', async () => {
    const token = await signCallerToken(
      { keyId: KEY_ID, scopes: ['quotes:read'], ttlSeconds: 600 },
      SECRET,
      NOW
    );
    const [h, p, s] = token.split('.') as [string, string, string];
    const flipped = p.slice(0, 5) + (p[5] === 'A' ? 'B' : 'A') + p.slice(6);
    expect(await verifyCallerToken(`${h}.${flipped}.${s}`, SECRET, NOW)).toEqual({
      ok: false,
      code: 'bad_signature',
    });
    expect(await verifyCallerToken(token, 'y'.repeat(32), NOW)).toEqual({
      ok: false,
      code: 'bad_signature',
    });
  });

  it('rejects alg none and HS512 headers as malformed_token', async () => {
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims())}.`;
    expect(await verifyCallerToken(none, SECRET, NOW)).toEqual({
      ok: false,
      code: 'malformed_token',
    });
    const hs512 = handSign(claims(), { alg: 'HS512', typ: 'JWT' });
    expect(await verifyCallerToken(hs512, SECRET, NOW)).toEqual({
      ok: false,
      code: 'malformed_token',
    });
  });

  it('is token_expired at exactly exp', async () => {
    const token = await signCallerToken(
      { keyId: KEY_ID, scopes: ['quotes:read'], ttlSeconds: 60 },
      SECRET,
      NOW
    );
    expect(await verifyCallerToken(token, SECRET, NOW + 59_000)).toMatchObject({ ok: true });
    expect(await verifyCallerToken(token, SECRET, NOW + 60_000)).toEqual({
      ok: false,
      code: 'token_expired',
    });
  });

  it('throws RangeError for ttlSeconds 901 and 0', async () => {
    for (const ttlSeconds of [901, 0]) {
      await expect(
        signCallerToken({ keyId: KEY_ID, scopes: ['quotes:read'], ttlSeconds }, SECRET, NOW)
      ).rejects.toBeInstanceOf(RangeError);
    }
  });

  it('gives wrong_audience for another aud', async () => {
    expect(await verifyCallerToken(handSign(claims({ aud: 'other' })), SECRET, NOW)).toEqual({
      ok: false,
      code: 'wrong_audience',
    });
  });

  it.each([
    ['an unknown scope', { scp: ['quotes:write'] }],
    ['an empty scp', { scp: [] }],
    ['an iat 60 s in the future', { iat: NOW_SEC + 60, exp: NOW_SEC + 600 }],
    ['a lifetime over 900 s', { exp: NOW_SEC + 901 }],
    ['a sub that is not a keyId', { sub: 'not-a-key-id' }],
  ])('gives malformed_token for %s', async (_label, overrides) => {
    expect(await verifyCallerToken(handSign(claims(overrides)), SECRET, NOW)).toEqual({
      ok: false,
      code: 'malformed_token',
    });
  });

  it('gives malformed_token for 2 and 4 segments', async () => {
    const token = handSign(claims());
    const [h, p, s] = token.split('.');
    for (const bad of [`${h}.${p}`, `${h}.${p}.${s}.${s}`]) {
      expect(await verifyCallerToken(bad, SECRET, NOW)).toEqual({
        ok: false,
        code: 'malformed_token',
      });
    }
  });
});

describe('getTokenSecret', () => {
  it('is null below 32 characters and the value at 32', () => {
    vi.stubEnv('CALLER_TOKEN_SECRET', 'x'.repeat(31));
    expect(getTokenSecret()).toBeNull();
    vi.stubEnv('CALLER_TOKEN_SECRET', 'x'.repeat(32));
    expect(getTokenSecret()).toBe('x'.repeat(32));
  });

  it('is null when unset', () => {
    vi.stubEnv('CALLER_TOKEN_SECRET', '');
    expect(getTokenSecret()).toBeNull();
  });
});

describe('looksLikeToken', () => {
  it('is false for an sik_ key and true for a token', async () => {
    expect(looksLikeToken(`sik_0123456789abcdef_${'A'.repeat(43)}`)).toBe(false);
    expect(looksLikeToken('a..c')).toBe(false);
    expect(looksLikeToken(handSign(claims()))).toBe(true);
  });
});
