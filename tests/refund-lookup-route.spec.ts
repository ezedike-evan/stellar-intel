// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/refunds/[intentHash]/route';
import {
  _setRefundStore,
  InMemoryRefundStore,
  toPublicRefundCase,
  type RefundCase,
} from '@/lib/refunds/store';
import { clearRateLimitStore } from '@/lib/api/rate-limit';

let store: InMemoryRefundStore;

const VALID_HASH = 'a'.repeat(64);
const UPPER_HASH = 'A'.repeat(64);

const SAMPLE_CASE: RefundCase = {
  id: '00000000-0000-0000-0000-000000000001',
  intentHash: VALID_HASH,
  reason: 'anchor_refunded',
  anchorId: 'cowrie',
  corridor: 'ngnt-ngn',
  direction: 'withdraw',
  signerAccount: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  amountPaid: '100',
  status: 'refunded',
  amountRefunded: '95',
  refundFee: '5',
  payments: [{ id: 'pay-1', idType: 'stellar', amount: '95', fee: '5' }],
  openedAt: '2026-11-20T10:00:00.000Z',
  refundedAt: '2026-11-20T10:05:00.000Z',
  acknowledgedAt: '2026-11-20T10:10:00.000Z',
  ackHash: 'b'.repeat(64),
  ackSignature: 'sig-sensitive-1234',
  onChainCheck: 'verified',
};

beforeEach(() => {
  clearRateLimitStore();
  store = new InMemoryRefundStore();
  _setRefundStore(store);
});

afterEach(() => {
  _setRefundStore(null);
});

describe('GET /api/refunds/[intentHash] (RFD008)', () => {
  it('returns 400 on "xyz" and on uppercase hex', async () => {
    const reqXyz = new NextRequest('http://localhost/api/refunds/xyz');
    const resXyz = await GET(reqXyz, { params: Promise.resolve({ intentHash: 'xyz' }) });
    expect(resXyz.status).toBe(400);
    const bodyXyz = await resXyz.json();
    expect(bodyXyz.code).toBe('VALIDATION_ERROR');

    const reqUpper = new NextRequest(`http://localhost/api/refunds/${UPPER_HASH}`);
    const resUpper = await GET(reqUpper, { params: Promise.resolve({ intentHash: UPPER_HASH }) });
    expect(resUpper.status).toBe(400);
    const bodyUpper = await resUpper.json();
    expect(bodyUpper.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with empty cases array for an unknown hash', async () => {
    const req = new NextRequest(`http://localhost/api/refunds/${VALID_HASH}`);
    const res = await GET(req, { params: Promise.resolve({ intentHash: VALID_HASH }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body).toEqual({ intentHash: VALID_HASH, cases: [] });
  });

  it('returns 200 with seeded case and no sensitive fields (signerAccount, ackSignature, ackHash)', async () => {
    await store.open(SAMPLE_CASE);

    const req = new NextRequest(`http://localhost/api/refunds/${VALID_HASH}`);
    const res = await GET(req, { params: Promise.resolve({ intentHash: VALID_HASH }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    const body = await res.json();
    expect(body.intentHash).toBe(VALID_HASH);
    expect(body.cases).toHaveLength(1);

    const rawJson = JSON.stringify(body);
    expect(rawJson).not.toContain('signerAccount');
    expect(rawJson).not.toContain('ackSignature');
    expect(rawJson).not.toContain('ackHash');
    expect(rawJson).not.toContain('sig-sensitive-1234');
    expect(rawJson).not.toContain('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
  });
});

describe('toPublicRefundCase', () => {
  it('does not leak unexpected properties or sensitive credentials to the output', () => {
    const inputWithExtra = {
      ...SAMPLE_CASE,
      unexpectedSecretField: 'secret-leaked-value',
    } as RefundCase & { unexpectedSecretField: string };

    const output = toPublicRefundCase(inputWithExtra);

    expect(output).not.toHaveProperty('signerAccount');
    expect(output).not.toHaveProperty('ackSignature');
    expect(output).not.toHaveProperty('ackHash');
    expect(output).not.toHaveProperty('unexpectedSecretField');
    expect(JSON.stringify(output)).not.toContain('secret-leaked-value');
    expect(output.id).toBe(SAMPLE_CASE.id);
    expect(output.status).toBe('refunded');
  });
});
