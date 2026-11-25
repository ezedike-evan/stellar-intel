// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/refunds/[intentHash]/route';
import {
  InMemoryRefundStore,
  _setRefundStore,
  toPublicRefundCase,
  type RefundCase,
} from '@/lib/refunds/store';

const HASH = 'a'.repeat(64);
const SIGNER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const ACK_HASH = 'd'.repeat(64);
const ACK_SIGNATURE = 'e'.repeat(128);

function refundCase(overrides: Partial<RefundCase> = {}): RefundCase {
  return {
    id: 'r-1',
    intentHash: HASH,
    reason: 'anchor_error_after_payment',
    anchorId: 'moneygram',
    corridor: 'USDC-NGN',
    direction: 'withdraw',
    signerAccount: SIGNER,
    amountPaid: '100.00',
    status: 'acknowledged',
    amountRefunded: '99.50',
    refundFee: '0.50',
    payments: [{ id: 'p-1', idType: 'stellar', amount: '99.50', fee: '0.50' }],
    openedAt: '2026-10-01T10:00:00.000Z',
    refundedAt: '2026-10-02T10:00:00.000Z',
    acknowledgedAt: '2026-10-02T10:00:00.000Z',
    ackHash: ACK_HASH,
    ackSignature: ACK_SIGNATURE,
    onChainCheck: 'verified',
    ...overrides,
  };
}

function call(intentHash: string) {
  const request = new NextRequest(`http://localhost/api/refunds/${intentHash}`, {
    headers: { 'x-forwarded-for': '203.0.113.7' },
  });
  return GET(request, { params: Promise.resolve({ intentHash }) });
}

describe('GET /api/refunds/[intentHash] (#2119)', () => {
  let store: InMemoryRefundStore;

  beforeEach(() => {
    store = new InMemoryRefundStore();
    _setRefundStore(store);
  });

  afterEach(() => {
    _setRefundStore(null);
  });

  it('returns 400 VALIDATION_ERROR for a value that is not hex', async () => {
    const res = await call('xyz');
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for uppercase hex', async () => {
    const res = await call('A'.repeat(64));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with an empty list for an unknown hash', async () => {
    const res = await call('b'.repeat(64));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ intentHash: 'b'.repeat(64), cases: [] });
  });

  it('returns the seeded case for a known hash', async () => {
    await store.open(refundCase());

    const res = await call(HASH);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.intentHash).toBe(HASH);
    expect(body.cases).toHaveLength(1);
    expect(body.cases[0]).toMatchObject({
      id: 'r-1',
      reason: 'anchor_error_after_payment',
      anchorId: 'moneygram',
      status: 'acknowledged',
      amountRefunded: '99.50',
      onChainCheck: 'verified',
    });
  });

  it('lists cases oldest first', async () => {
    const newer = refundCase({
      id: 'r-new',
      reason: 'expired_after_payment',
      openedAt: '2026-10-05T00:00:00.000Z',
    });
    const older = refundCase({ id: 'r-old', openedAt: '2026-10-01T00:00:00.000Z' });
    await store.open(newer);
    await store.open(older);

    const body = await (await call(HASH)).json();

    expect(body.cases.map((c: { id: string }) => c.id)).toEqual(['r-old', 'r-new']);
  });

  it('never exposes the signer account or the acknowledgement proof', async () => {
    await store.open(refundCase());

    const text = JSON.stringify(await (await call(HASH)).json());

    const secrets = ['signerAccount', 'ackSignature', 'ackHash', SIGNER, ACK_HASH, ACK_SIGNATURE];
    for (const secret of secrets) {
      expect(text).not.toContain(secret);
    }
  });

  it('sets Cache-Control to no-store', async () => {
    expect((await call(HASH)).headers.get('Cache-Control')).toBe('no-store');
    expect((await call('xyz')).headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('toPublicRefundCase', () => {
  it('drops the private fields', () => {
    const view = toPublicRefundCase(refundCase());

    expect(view).not.toHaveProperty('signerAccount');
    expect(view).not.toHaveProperty('ackSignature');
    expect(view).not.toHaveProperty('ackHash');
    expect(view.id).toBe('r-1');
  });

  it('does not leak an unexpected property added to the input', () => {
    const input = { ...refundCase(), internalNote: 'do not publish' } as RefundCase;

    const view = toPublicRefundCase(input);

    expect(view).not.toHaveProperty('internalNote');
    expect(JSON.stringify(view)).not.toContain('do not publish');
  });

  it('does not leak an unexpected property on a payment', () => {
    const input = refundCase({
      payments: [{ id: 'p-1', idType: 'stellar', amount: '1', fee: '0', secret: 'x' } as never],
    });

    expect(toPublicRefundCase(input).payments[0]).toEqual({
      id: 'p-1',
      idType: 'stellar',
      amount: '1',
      fee: '0',
    });
  });
});
