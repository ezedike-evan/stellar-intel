import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/intent/offramp/route';
import { checkRateLimit, clearRateLimitStore } from '@/lib/api/rate-limit';
import { clearIdempotencyStore } from '@/lib/api/idempotency';
import type { OfframpIntentResponse } from '@/app/api/intent/offramp/route';
import type { ApiError } from '@/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// A valid Stellar public key (USDC issuer on mainnet)
const VALID_SENDER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

// Routing now requires explicitly configured payment accounts (#941). These are
// well-formed keys for test routing only — the previous hardcoded destinations
// were addresses that did not exist on mainnet.
const TEST_ANCHOR_ACCOUNTS = JSON.stringify({
  cowrie: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  moneygram: 'GAZW2PQFFJGH7RH6PB5VQASJIRAGEMZCID72CXYHRM27QYP4R5YRY777',
});

const VALID_INTENT = {
  type: 'offramp',
  sourceAsset: 'USDC',
  destinationAsset: 'NGN',
  amount: '100',
  sender: VALID_SENDER,
  recipient: 'NGN-BANK-ACCOUNT-123',
};

function makeRequest(body: unknown, headers?: HeadersInit): NextRequest {
  return new NextRequest('http://localhost/api/intent/offramp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  clearRateLimitStore();
  clearIdempotencyStore();
  // Routing is configuration-driven now; without this every corridor is
  // correctly unroutable (#941).
  vi.stubEnv('ANCHOR_PAYMENT_ACCOUNTS', TEST_ANCHOR_ACCOUNTS);
});

// ─── Happy path ────────────────────────────────────────────────────────────────

describe('POST /api/intent/offramp — happy path', () => {
  it('returns 200 with route, unsignedTx, and quoteId', async () => {
    const res = await POST(makeRequest(VALID_INTENT));
    expect(res.status).toBe(200);

    const data = (await res.json()) as OfframpIntentResponse;
    expect(data).toHaveProperty('route');
    expect(data).toHaveProperty('unsignedTx');
    expect(data).toHaveProperty('quoteId');
  });

  it('unsignedTx is a non-empty Stellar XDR envelope string', async () => {
    const res = await POST(makeRequest(VALID_INTENT));
    const data = (await res.json()) as OfframpIntentResponse;

    // Stellar XDR envelopes are base64 strings
    expect(typeof data.unsignedTx).toBe('string');
    expect(data.unsignedTx.length).toBeGreaterThan(10);
    // Valid base64 pattern (may include padding =)
    expect(data.unsignedTx).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('quoteId is a 64-char lowercase hex SHA-256 hash', async () => {
    const res = await POST(makeRequest(VALID_INTENT));
    const data = (await res.json()) as OfframpIntentResponse;
    expect(data.quoteId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('quoteId is deterministic — same intent yields same quoteId', async () => {
    const res1 = await POST(makeRequest(VALID_INTENT));
    const res2 = await POST(makeRequest({ ...VALID_INTENT }));
    const d1 = (await res1.json()) as OfframpIntentResponse;
    const d2 = (await res2.json()) as OfframpIntentResponse;
    expect(d1.quoteId).toBe(d2.quoteId);
  });

  it('route includes anchorId, anchorDomain, and corridorId', async () => {
    const res = await POST(makeRequest(VALID_INTENT));
    const data = (await res.json()) as OfframpIntentResponse;
    // Registry order, not the old hardcoded 'cowrie'. Selection among several
    // configured anchors stays arbitrary until #790 wires the scorer in — but it
    // is now arbitrary among anchors that exist and have a verified payment
    // account, rather than a fixed choice nobody documented.
    expect(data.route.anchorId).toBe('moneygram');
    expect(data.route.anchorDomain).toBe('stellar.moneygram.com');
    expect(data.route.corridorId).toBe('usdc-ngn');
  });

  it('accepts a KES corridor and routes to a registered anchor', async () => {
    // Was asserting 'flutterwave', which is not in constants/anchors.ts at all —
    // the test pinned a routing target the rest of the system did not know
    // about, paying to an address that did not exist (#941).
    const kesIntent = { ...VALID_INTENT, destinationAsset: 'KES' };
    const res = await POST(makeRequest(kesIntent));
    expect(res.status).toBe(200);
    const data = (await res.json()) as OfframpIntentResponse;
    expect(data.route.anchorId).toBe('moneygram');
    expect(data.route.corridorId).toBe('usdc-kes');
  });

  it('refuses to route a corridor with no configured payment account', async () => {
    vi.stubEnv('ANCHOR_PAYMENT_ACCOUNTS', JSON.stringify({ cowrie: VALID_SENDER }));

    const kesIntent = { ...VALID_INTENT, destinationAsset: 'KES' };
    const res = await POST(makeRequest(kesIntent));

    // The important half: it fails loudly rather than inventing a destination.
    expect(res.status).toBe(400);
    const err = (await res.json()) as ApiError;
    expect(err.code).toBe('NO_ROUTE');
    expect(err.message).toContain('No payment account configured');
    // And it names who *could* serve it, so the gap is actionable.
    expect(err.message).toContain('moneygram');
  });

  it('rejects a malformed account rather than routing to it', async () => {
    vi.stubEnv('ANCHOR_PAYMENT_ACCOUNTS', JSON.stringify({ cowrie: 'not-a-stellar-key' }));

    const res = await POST(makeRequest(VALID_INTENT));

    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiError).code).toBe('NO_ROUTE');
  });
});

// ─── Validation errors (400) ───────────────────────────────────────────────────

describe('POST /api/intent/offramp — validation errors', () => {
  it('returns 400 with code VALIDATION_ERROR when type is missing', async () => {
    const { type: _type, ...noType } = VALID_INTENT;
    const res = await POST(makeRequest(noType));
    expect(res.status).toBe(400);

    const err = (await res.json()) as ApiError;
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(typeof err.message).toBe('string');
  });

  it('returns 400 when type is not "offramp"', async () => {
    const res = await POST(makeRequest({ ...VALID_INTENT, type: 'deposit' }));
    expect(res.status).toBe(400);
    const err = (await res.json()) as ApiError;
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when amount is not a decimal string', async () => {
    const res = await POST(makeRequest({ ...VALID_INTENT, amount: 'not-a-number' }));
    expect(res.status).toBe(400);
    const err = (await res.json()) as ApiError;
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when sender is an empty string', async () => {
    const res = await POST(makeRequest({ ...VALID_INTENT, sender: '' }));
    expect(res.status).toBe(400);
    const err = (await res.json()) as ApiError;
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 with code NO_ROUTE for an unsupported corridor', async () => {
    const res = await POST(makeRequest({ ...VALID_INTENT, destinationAsset: 'EUR' }));
    expect(res.status).toBe(400);
    const err = (await res.json()) as ApiError;
    expect(err.code).toBe('NO_ROUTE');
  });

  it('returns 400 with INVALID_JSON when body is not JSON', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/intent/offramp', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'not json at all',
      })
    );
    expect(res.status).toBe(400);
    const err = (await res.json()) as ApiError;
    expect(err.code).toBe('INVALID_JSON');
  });

  it('returns 400 when recipient is empty', async () => {
    const res = await POST(makeRequest({ ...VALID_INTENT, recipient: '' }));
    expect(res.status).toBe(400);
    const err = (await res.json()) as ApiError;
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('error body always contains a string message field', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const err = (await res.json()) as ApiError;
    expect(typeof err.message).toBe('string');
    expect(err.message.length).toBeGreaterThan(0);
  });
});

// ─── Rate limiting (429) ────────────────────────────────────────────────────────

describe('POST /api/intent/offramp — rate limiting', () => {
  it('succeeds while under the api.intent.offramp limit', async () => {
    const headers = { 'x-forwarded-for': '203.0.113.10' };
    for (let i = 0; i < 19; i++) {
      const res = await POST(makeRequest(VALID_INTENT, headers));
      expect(res.status).toBe(200);
    }
  });

  it('returns 429 with Retry-After once the bucket is exhausted', async () => {
    const ip = '203.0.113.20';
    for (let i = 0; i < 20; i++) {
      await checkRateLimit(ip, { bucket: 'api.intent.offramp', maxRequests: 20 });
    }

    const res = await POST(makeRequest(VALID_INTENT, { 'x-forwarded-for': ip }));

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(res.headers.get('X-RateLimit-Limit')).toBe('20');

    const body = (await res.json()) as ApiError;
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.message).toBe('Too many requests');
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  it('rate-limits independently per IP', async () => {
    const exhaustedIp = '203.0.113.30';
    for (let i = 0; i < 20; i++) {
      await checkRateLimit(exhaustedIp, { bucket: 'api.intent.offramp', maxRequests: 20 });
    }

    const blocked = await POST(makeRequest(VALID_INTENT, { 'x-forwarded-for': exhaustedIp }));
    expect(blocked.status).toBe(429);

    const otherIpRes = await POST(makeRequest(VALID_INTENT, { 'x-forwarded-for': '203.0.113.31' }));
    expect(otherIpRes.status).toBe(200);
  });
});

// ─── Versioning + rate-limit headers (#805) ────────────────────────────────────

describe('POST /api/intent/offramp — versioning and rate-limit headers', () => {
  it('stamps API-Version on a success response', async () => {
    const res = await POST(makeRequest(VALID_INTENT));
    expect(res.headers.get('API-Version')).toBeTruthy();
  });

  it('stamps API-Version on an error response', async () => {
    const res = await POST(makeRequest({ ...VALID_INTENT, type: 'deposit' }));
    expect(res.headers.get('API-Version')).toBeTruthy();
  });

  it('includes X-RateLimit-Limit and X-RateLimit-Reset on a success response', async () => {
    const res = await POST(makeRequest(VALID_INTENT, { 'x-forwarded-for': '203.0.113.40' }));
    expect(res.headers.get('X-RateLimit-Limit')).toBe('20');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('19');
    expect(Number(res.headers.get('X-RateLimit-Reset'))).toBeGreaterThan(0);
  });
});

// ─── Idempotency-Key (#805) ─────────────────────────────────────────────────────

describe('POST /api/intent/offramp — idempotency', () => {
  it('replays the original response for a repeated Idempotency-Key without re-executing', async () => {
    const headers = { 'Idempotency-Key': 'test-key-1', 'x-forwarded-for': '203.0.113.50' };

    const first = await POST(makeRequest(VALID_INTENT, headers));
    const firstBody = (await first.json()) as OfframpIntentResponse;
    expect(first.headers.get('Idempotency-Replayed')).toBeNull();

    // A different intent under the same key must still return the FIRST
    // response verbatim -- that's the point of an idempotency key.
    const second = await POST(makeRequest({ ...VALID_INTENT, destinationAsset: 'KES' }, headers));
    const secondBody = (await second.json()) as OfframpIntentResponse;

    expect(second.status).toBe(first.status);
    expect(second.headers.get('Idempotency-Replayed')).toBe('true');
    expect(secondBody).toEqual(firstBody);
  });

  it('does not replay across different Idempotency-Key values', async () => {
    const res1 = await POST(
      makeRequest(VALID_INTENT, { 'Idempotency-Key': 'key-a', 'x-forwarded-for': '203.0.113.51' })
    );
    const res2 = await POST(
      makeRequest(VALID_INTENT, { 'Idempotency-Key': 'key-b', 'x-forwarded-for': '203.0.113.51' })
    );

    expect(res2.headers.get('Idempotency-Replayed')).toBeNull();
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  it('does not apply idempotency replay when no Idempotency-Key header is sent', async () => {
    const res = await POST(makeRequest(VALID_INTENT, { 'x-forwarded-for': '203.0.113.52' }));
    expect(res.headers.get('Idempotency-Replayed')).toBeNull();
  });

  it('replays a cacheable error (400) for a repeated key without re-validating', async () => {
    const headers = { 'Idempotency-Key': 'key-error-1', 'x-forwarded-for': '203.0.113.53' };
    const badIntent = { ...VALID_INTENT, destinationAsset: 'EUR' };

    const first = await POST(makeRequest(badIntent, headers));
    expect(first.status).toBe(400);

    const second = await POST(makeRequest(badIntent, headers));
    expect(second.status).toBe(400);
    expect(second.headers.get('Idempotency-Replayed')).toBe('true');
  });

  it('bypasses rate limiting for an idempotent replay', async () => {
    const ip = '203.0.113.54';
    const headers = { 'Idempotency-Key': 'key-bypass', 'x-forwarded-for': ip };

    await POST(makeRequest(VALID_INTENT, headers));
    // Exhaust the bucket directly so a fresh (non-idempotent) request would 429.
    for (let i = 0; i < 20; i++) {
      await checkRateLimit(ip, { bucket: 'api.intent.offramp', maxRequests: 20 });
    }

    const replay = await POST(makeRequest(VALID_INTENT, headers));
    expect(replay.status).toBe(200);
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true');
  });
});
