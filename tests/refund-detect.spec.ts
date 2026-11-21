import { describe, expect, it } from 'vitest';
import {
  detectRefundReason,
  openRefundCaseForOutcome,
  refundCaseFromOutcome,
} from '@/lib/refunds/detect';
import { InMemoryRefundStore } from '@/lib/refunds/store';
import type { OutcomeLogRow } from '@/types/reputation';

const SIGNER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const NOW = new Date('2026-11-21T10:00:00.000Z');

function row(overrides: Partial<OutcomeLogRow> = {}): OutcomeLogRow {
  return {
    intentHash: 'a'.repeat(64),
    anchorId: 'cowrie',
    corridor: 'ngnt-ngn',
    direction: 'withdraw',
    quotedRate: '1500.0',
    deliveredRate: null,
    quotedAmount: '100',
    deliveredAmount: null,
    settleSeconds: null,
    outcome: 'completed',
    createdAt: '2026-11-21T10:00:00.000Z',
    stellarTransactionId: 'b'.repeat(64),
    reconciledAt: null,
    disputed: false,
    disputedReason: null,
    publishedAt: null,
    oracleTxHash: null,
    attested: true,
    signerAccount: SIGNER,
    ...overrides,
  };
}

describe('detectRefundReason', () => {
  it.each([
    ['a refunded withdrawal', { outcome: 'refunded' as const }, 'anchor_refunded'],
    [
      'a refunded deposit',
      { outcome: 'refunded' as const, direction: 'deposit' as const },
      'anchor_refunded',
    ],
    [
      'a withdrawal error after payment',
      { outcome: 'error' as const },
      'anchor_error_after_payment',
    ],
    ['a withdrawal expiry after payment', { outcome: 'expired' as const }, 'expired_after_payment'],
  ])('detects %s', (_label, extra, expected) => {
    expect(detectRefundReason(row(extra))).toBe(expected);
  });

  it.each([
    ['a completed row', { outcome: 'completed' as const }],
    ['a partial row', { outcome: 'partial' as const }],
    [
      'a withdrawal error with no payment',
      { outcome: 'error' as const, stellarTransactionId: null },
    ],
    [
      'a withdrawal expiry with no payment',
      { outcome: 'expired' as const, stellarTransactionId: null },
    ],
    ['a deposit error after payment', { outcome: 'error' as const, direction: 'deposit' as const }],
    [
      'a deposit expiry after payment',
      { outcome: 'expired' as const, direction: 'deposit' as const },
    ],
  ])('returns null for %s', (_label, extra) => {
    expect(detectRefundReason(row(extra))).toBeNull();
  });
});

describe('refundCaseFromOutcome', () => {
  it('builds a refunded case for anchor_refunded', () => {
    const record = refundCaseFromOutcome(row({ outcome: 'refunded' }), 'anchor_refunded', NOW);
    expect(record).toMatchObject({
      intentHash: 'a'.repeat(64),
      reason: 'anchor_refunded',
      anchorId: 'cowrie',
      corridor: 'ngnt-ngn',
      direction: 'withdraw',
      signerAccount: SIGNER,
      amountPaid: '100',
      status: 'refunded',
      refundedAt: '2026-11-21T10:00:00.000Z',
      openedAt: '2026-11-21T10:00:00.000Z',
      amountRefunded: null,
      refundFee: null,
      payments: [],
      acknowledgedAt: null,
      ackHash: null,
      ackSignature: null,
      onChainCheck: null,
    });
    expect(record?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('builds an owed case for anchor_error_after_payment', () => {
    const record = refundCaseFromOutcome(
      row({ outcome: 'error' }),
      'anchor_error_after_payment',
      NOW
    );
    expect(record).toMatchObject({ status: 'owed', refundedAt: null });
  });

  it('returns null for an unattested row', () => {
    expect(refundCaseFromOutcome(row({ attested: false }), 'anchor_refunded', NOW)).toBeNull();
  });

  it('returns null when the signer is unknown', () => {
    expect(refundCaseFromOutcome(row({ signerAccount: null }), 'anchor_refunded', NOW)).toBeNull();
  });
});

describe('openRefundCaseForOutcome', () => {
  it('inserts the case and returns it', async () => {
    const store = new InMemoryRefundStore();
    const opened = await openRefundCaseForOutcome(row({ outcome: 'refunded' }), store);
    expect(opened?.reason).toBe('anchor_refunded');
    expect(opened?.status).toBe('refunded');
    expect(await store.list()).toHaveLength(1);
  });

  it('returns null the second time for the same outcome', async () => {
    const store = new InMemoryRefundStore();
    const first = await openRefundCaseForOutcome(row({ outcome: 'refunded' }), store);
    expect(first).not.toBeNull();
    expect(await openRefundCaseForOutcome(row({ outcome: 'refunded' }), store)).toBeNull();
    expect(await store.list()).toHaveLength(1);
  });

  it('returns null when nothing is implied', async () => {
    const store = new InMemoryRefundStore();
    expect(await openRefundCaseForOutcome(row(), store)).toBeNull();
    expect(await store.list()).toHaveLength(0);
  });

  it('returns null for an unattested refunded row', async () => {
    const store = new InMemoryRefundStore();
    expect(
      await openRefundCaseForOutcome(row({ outcome: 'refunded', attested: false }), store)
    ).toBeNull();
    expect(await store.list()).toHaveLength(0);
  });
});
