import { describe, it, expect } from 'vitest';
import {
  signCallerToken,
  verifyCallerToken,
  looksLikeToken,
  DEFAULT_TOKEN_EXP_SECONDS,
  TOKEN_AUDIENCE,
} from '@/lib/auth/token';

describe('Caller Tokens (HS256 JWT)', () => {
  const secret = 'super-secret-test-key-of-sufficient-length-32-bytes!';

  it('checks token format with looksLikeToken', () => {
    expect(looksLikeToken('a.b.c')).toBe(true);
    expect(looksLikeToken('abc')).toBe(false);
    expect(looksLikeToken('a.b')).toBe(false);
  });

  it('signs and verifies a valid token', async () => {
    const token = await signCallerToken(
      {
        sub: 'service-worker-1',
        scopes: ['quotes:read', 'metrics:read'],
      },
      secret
    );

    expect(looksLikeToken(token)).toBe(true);

    const verified = await verifyCallerToken(token, secret);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.sub).toBe('service-worker-1');
      expect(verified.payload.scopes).toEqual(['quotes:read', 'metrics:read']);
      expect(verified.payload.aud).toBe(TOKEN_AUDIENCE);
    }
  });

  it('rejects an invalid signature', async () => {
    const token = await signCallerToken(
      {
        sub: 'service-worker-1',
        scopes: ['quotes:read'],
      },
      secret
    );

    const verified = await verifyCallerToken(token, 'wrong-secret-key-that-does-not-match-32b');
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.code).toBe('INVALID_SIGNATURE');
    }
  });

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signCallerToken(
      {
        sub: 'service-worker-1',
        scopes: ['quotes:read'],
        iat: now - 500,
        exp: now - 100,
      },
      secret
    );

    const verified = await verifyCallerToken(token, secret);
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.code).toBe('EXPIRED');
    }
  });

  it('rejects invalid audience', async () => {
    const token = await signCallerToken(
      {
        sub: 'service-worker-1',
        scopes: ['quotes:read'],
        aud: 'wrong-audience',
      },
      secret
    );

    const verified = await verifyCallerToken(token, secret);
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.code).toBe('INVALID_AUDIENCE');
    }
  });
});
