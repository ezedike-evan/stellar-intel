import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/intent/offramp/route';
import type { OfframpIntentResponse } from '@/app/api/intent/offramp/route';
import type { ApiError } from '@/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// A valid Stellar public key (USDC issuer on mainnet)
const VALID_SENDER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const VALID_INTENT = {
  type: 'offramp',
  sourceAsset: 'USDC',
  destinationAsset: 'NGN',
  amount: '100',
  sender: VALID_SENDER,
  recipient: 'NGN-BANK-ACCOUNT-123',
};

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/intent/offramp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(data.route.anchorId).toBe('cowrie');
    expect(data.route.anchorDomain).toBe('cowrie.exchange');
    expect(data.route.corridorId).toBe('usdc-ngn');
  });

  it('accepts a KES corridor and returns the flutterwave anchor', async () => {
    const kesIntent = { ...VALID_INTENT, destinationAsset: 'KES' };
    const res = await POST(makeRequest(kesIntent));
    expect(res.status).toBe(200);
    const data = (await res.json()) as OfframpIntentResponse;
    expect(data.route.anchorId).toBe('flutterwave');
    expect(data.route.corridorId).toBe('usdc-kes');
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
