import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Keypair } from '@stellar/stellar-sdk';
import { clearIdempotencyStore } from '@/lib/api/v1';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import { hashIntent } from '@/lib/intent/hash';
import type { OnrampResult } from '@/lib/intent/onramp';

const createOnrampIntent = vi.fn();
vi.mock('@/lib/intent/onramp', () => ({
  createOnrampIntent: (...args: unknown[]) => createOnrampIntent(...args),
}));

import { POST } from '@/app/api/v1/intent/onramp/route';

const SIGNER = Keypair.random();

const INTENT = {
  type: 'onramp',
  sourceAsset: 'NGN',
  destinationAsset: 'USDC',
  amount: '10000',
  sender: 'acct-001',
  destination: Keypair.random().publicKey(),
  depositMethod: 'bank_transfer',
};

const OK: OnrampResult = {
  ok: true,
  response: {
    route: {
      anchorId: 'anchor-a',
      anchorDomain: 'anchor.example',
      corridorId: 'usdc-ngn',
      asset: 'stellar:USDC:GISSUER',
      estimatedFee: '1.5',
      estimatedReceived: '6.4',
      indicative: true,
    },
    intentHash: 'ab'.repeat(32),
    handoffUrl: '/onramp?corridor=usdc-ngn&amount=10000&anchor=anchor-a',
    unsignedChangeTrustXdr: null,
  },
};

function post(body: unknown, headers: HeadersInit = {}): NextRequest {
  return new NextRequest('http://localhost/api/v1/intent/onramp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  clearRateLimitStore();
  clearIdempotencyStore();
  createOnrampIntent.mockReset();
  createOnrampIntent.mockResolvedValue(OK);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/v1/intent/onramp (#1474)', () => {
  it('returns the routed intent with rate-limit headers', async () => {
    const res = await POST(post(INTENT));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(OK.ok ? OK.response : null);
    expect(res.headers.get('x-ratelimit-limit')).toBe('20');
    expect(res.headers.get('x-request-id')).toBeTruthy();
    expect(createOnrampIntent).toHaveBeenCalledWith(expect.objectContaining(INTENT));
  });

  it('rejects an invalid destination key with a validation_error 400', async () => {
    const res = await POST(post({ ...INTENT, destination: 'not-a-key' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('validation_error');
    expect(body.error.message).toMatch(/destination/);
    expect(createOnrampIntent).not.toHaveBeenCalled();
  });

  it('rejects an unparseable body with a validation_error 400', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/v1/intent/onramp', { method: 'POST', body: 'nope' })
    );
    expect(res.status).toBe(400);
  });

  it('accepts a correctly signed attestation', async () => {
    const hash = await hashIntent(INTENT);
    const signature = Buffer.from(SIGNER.sign(Buffer.from(hash, 'hex'))).toString('base64');
    const res = await POST(post({ ...INTENT, signature, publicKey: SIGNER.publicKey() }));

    expect(res.status).toBe(200);
  });

  it('answers 401 for a bad attestation signature', async () => {
    const signature = Buffer.from(SIGNER.sign(Buffer.from('00'.repeat(32), 'hex'))).toString(
      'base64'
    );
    const res = await POST(post({ ...INTENT, signature, publicKey: SIGNER.publicKey() }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe('unauthorized');
    expect(createOnrampIntent).not.toHaveBeenCalled();
  });

  it('answers 400 when only one of signature and publicKey is sent', async () => {
    const res = await POST(post({ ...INTENT, publicKey: SIGNER.publicKey() }));
    expect(res.status).toBe(400);
  });

  it('replays the original response for a repeated Idempotency-Key', async () => {
    const headers = { 'Idempotency-Key': 'onramp-key-1' };
    const first = await POST(post(INTENT, headers));
    const second = await POST(post(INTENT, headers));

    expect(first.headers.get('Idempotency-Replayed')).toBeNull();
    expect(second.status).toBe(200);
    expect(second.headers.get('Idempotency-Replayed')).toBe('true');
    expect(await second.json()).toEqual(await first.json());
    expect(createOnrampIntent).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['NO_ROUTE', 404, 'no_route'],
    ['RATE_UNAVAILABLE', 503, 'rate_unavailable'],
    ['ACCOUNT_NOT_FOUND', 422, 'account_not_found'],
  ] as const)('passes %s through as %i / %s', async (code, status, envelopeCode) => {
    createOnrampIntent.mockResolvedValue({ ok: false, code, message: 'nope', status });
    const res = await POST(post(INTENT));
    const body = await res.json();

    expect(res.status).toBe(status);
    expect(body.error).toMatchObject({ code: envelopeCode, message: 'nope' });
  });
});
