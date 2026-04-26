import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitChallenge, Sep10AuthError } from '@/lib/stellar/sep10';

const WEB_AUTH_ENDPOINT = 'https://cowrie.exchange/auth';
const SIGNED_XDR = 'AAAAAQAAAAD...';

// Payload: {"exp":9999999999} — far-future expiry
const VALID_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjk5OTk5OTk5OTl9.fake-sig';
// Payload: {"exp":1} — expired (2001-09-09)
const EXPIRED_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjF9.fake-sig';
// Payload: {"sub":"test"} — no exp field
const NO_EXP_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.fake-sig';

beforeEach(() => {
  vi.restoreAllMocks();
});

// ─── Typed HTTP errors ────────────────────────────────────────────────────────

describe('Sep10AuthError', () => {
  it('is an instance of Error', () => {
    const err = new Sep10AuthError('bad request', 400);
    expect(err).toBeInstanceOf(Error);
  });

  it('preserves the HTTP status code', () => {
    const err = new Sep10AuthError('unauthorized', 401);
    expect(err.status).toBe(401);
  });

  it('sets the name to Sep10AuthError', () => {
    const err = new Sep10AuthError('forbidden', 403);
    expect(err.name).toBe('Sep10AuthError');
  });
});

describe('submitChallenge — non-200 responses', () => {
  it('throws Sep10AuthError with status 401 on unauthorized', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401 }))
    );

    const err = await submitChallenge(WEB_AUTH_ENDPOINT, SIGNED_XDR).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Sep10AuthError);
    expect((err as Sep10AuthError).status).toBe(401);
  });

  it('throws Sep10AuthError with status 403 on forbidden', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403 }))
    );

    const err = await submitChallenge(WEB_AUTH_ENDPOINT, SIGNED_XDR).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Sep10AuthError);
    expect((err as Sep10AuthError).status).toBe(403);
  });

  it('throws Sep10AuthError with status 500 on server error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 }))
    );

    const err = await submitChallenge(WEB_AUTH_ENDPOINT, SIGNED_XDR).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Sep10AuthError);
    expect((err as Sep10AuthError).status).toBe(500);
  });

  it('error message contains the HTTP status code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401 }))
    );

    await expect(submitChallenge(WEB_AUTH_ENDPOINT, SIGNED_XDR)).rejects.toThrow(/401/);
  });
});

// ─── JWT exp decoding ─────────────────────────────────────────────────────────

describe('submitChallenge — JWT exp decoding', () => {
  it('returns the correct expiresAt from the JWT exp claim', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ token: VALID_JWT }),
      }))
    );

    const result = await submitChallenge(WEB_AUTH_ENDPOINT, SIGNED_XDR);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt.getTime()).toBe(9999999999 * 1000);
  });

  it('returns the token unchanged', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ token: VALID_JWT }),
      }))
    );

    const result = await submitChallenge(WEB_AUTH_ENDPOINT, SIGNED_XDR);
    expect(result.token).toBe(VALID_JWT);
  });

  it('throws when the JWT exp is in the past', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ token: EXPIRED_JWT }),
      }))
    );

    await expect(submitChallenge(WEB_AUTH_ENDPOINT, SIGNED_XDR)).rejects.toThrow(/expired/);
  });

  it('throws when the JWT is missing an exp claim', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ token: NO_EXP_JWT }),
      }))
    );

    await expect(submitChallenge(WEB_AUTH_ENDPOINT, SIGNED_XDR)).rejects.toThrow(/"exp"/);
  });

  it('throws when the JWT does not have 3 segments', async () => {
    const malformed = 'only.two';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ token: malformed }),
      }))
    );

    await expect(submitChallenge(WEB_AUTH_ENDPOINT, SIGNED_XDR)).rejects.toThrow(/3 dot-separated/);
  });
});
