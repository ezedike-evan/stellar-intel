import { describe, it, expect } from 'vitest';
import {
  REFUND_ACK_TYPE,
  REFUND_ACK_VERSION,
  RefundAckPaymentSchema,
  RefundAckPayloadSchema,
  buildRefundAck,
  hashRefundAck,
  type RefundAckPayload,
} from '@/lib/refunds/ack';
import { canonicalJsonValue, hashCanonical, hashIntent, canonicalJson } from '@/lib/intent/hash';
import type { Sep24Refunds } from '@/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ACCOUNT = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const INTENT_HASH = 'f24f63585861ffb5fc8d06ddb5d572215650e15332831af81f62a71b056b562e';
const ANCHOR_ID = 'test-anchor';

const SAMPLE_REFUNDS: Sep24Refunds = {
  amount_refunded: '95.00',
  amount_fee: '5.00',
  payments: [
    {
      id: 'pay_1',
      id_type: 'stellar',
      amount: '50.00',
      fee: '2.50',
    },
    {
      id: 'pay_2',
      id_type: 'external',
      amount: '45.00',
      fee: '2.50',
    },
  ],
};

const VALID_PAYLOAD: RefundAckPayload = {
  type: 'refund-ack',
  version: 1,
  intentHash: INTENT_HASH,
  anchorId: ANCHOR_ID,
  account: ACCOUNT,
  amountRefunded: '95.00',
  refundFee: '5.00',
  payments: [
    {
      id: 'pay_1',
      idType: 'stellar',
      amount: '50.00',
    },
    {
      id: 'pay_2',
      idType: 'external',
      amount: '45.00',
    },
  ],
};

// ─── Schema Validation ────────────────────────────────────────────────────────

describe('RefundAckPayloadSchema', () => {
  it('accepts a valid refund acknowledgement payload', () => {
    const result = RefundAckPayloadSchema.safeParse(VALID_PAYLOAD);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(VALID_PAYLOAD);
    }
  });

  it('rejects extra properties at the root level (.strict())', () => {
    const withExtra = { ...VALID_PAYLOAD, unexpectedField: 'malicious' };
    const result = RefundAckPayloadSchema.safeParse(withExtra);
    expect(result.success).toBe(false);
  });

  it('rejects extra properties inside payment items (.strict())', () => {
    const withPaymentFee = {
      ...VALID_PAYLOAD,
      payments: [
        {
          id: 'pay_1',
          idType: 'stellar',
          amount: '50.00',
          fee: '2.50', // fee is forbidden in RefundAckPayment
        },
      ],
    };
    const result = RefundAckPayloadSchema.safeParse(withPaymentFee);
    expect(result.success).toBe(false);
  });

  it('rejects invalid type literals', () => {
    const invalid = { ...VALID_PAYLOAD, type: 'intent' };
    const result = RefundAckPayloadSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects invalid version literals', () => {
    const invalid = { ...VALID_PAYLOAD, version: 2 };
    const result = RefundAckPayloadSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  describe('intentHash validation', () => {
    it('rejects hashes of length != 64', () => {
      expect(
        RefundAckPayloadSchema.safeParse({ ...VALID_PAYLOAD, intentHash: 'a'.repeat(63) }).success
      ).toBe(false);
      expect(
        RefundAckPayloadSchema.safeParse({ ...VALID_PAYLOAD, intentHash: 'a'.repeat(65) }).success
      ).toBe(false);
      expect(RefundAckPayloadSchema.safeParse({ ...VALID_PAYLOAD, intentHash: '' }).success).toBe(
        false
      );
    });

    it('rejects hashes with uppercase characters', () => {
      expect(
        RefundAckPayloadSchema.safeParse({ ...VALID_PAYLOAD, intentHash: 'A'.repeat(64) }).success
      ).toBe(false);
      expect(
        RefundAckPayloadSchema.safeParse({
          ...VALID_PAYLOAD,
          intentHash: INTENT_HASH.toUpperCase(),
        }).success
      ).toBe(false);
    });

    it('rejects hashes with non-hex characters', () => {
      expect(
        RefundAckPayloadSchema.safeParse({ ...VALID_PAYLOAD, intentHash: 'g'.repeat(64) }).success
      ).toBe(false);
    });
  });

  describe('anchorId validation', () => {
    it('rejects empty anchorId', () => {
      expect(RefundAckPayloadSchema.safeParse({ ...VALID_PAYLOAD, anchorId: '' }).success).toBe(
        false
      );
    });

    it('rejects anchorId exceeding 64 characters', () => {
      expect(
        RefundAckPayloadSchema.safeParse({ ...VALID_PAYLOAD, anchorId: 'a'.repeat(65) }).success
      ).toBe(false);
    });
  });

  describe('account validation', () => {
    it('rejects accounts not matching STELLAR_PUBKEY_PATTERN', () => {
      expect(
        RefundAckPayloadSchema.safeParse({ ...VALID_PAYLOAD, account: 'invalid-address' }).success
      ).toBe(false);
      // Non-G prefix
      expect(
        RefundAckPayloadSchema.safeParse({
          ...VALID_PAYLOAD,
          account: 'C' + ACCOUNT.slice(1),
        }).success
      ).toBe(false);
      // Contains invalid base32 (0, 1, 8, 9)
      expect(
        RefundAckPayloadSchema.safeParse({
          ...VALID_PAYLOAD,
          account: ACCOUNT.slice(0, 55) + '8',
        }).success
      ).toBe(false);
    });
  });

  describe('amountRefunded and refundFee validation', () => {
    it('rejects negative amounts', () => {
      expect(
        RefundAckPayloadSchema.safeParse({ ...VALID_PAYLOAD, amountRefunded: '-95.00' }).success
      ).toBe(false);
      expect(
        RefundAckPayloadSchema.safeParse({ ...VALID_PAYLOAD, refundFee: '-5.00' }).success
      ).toBe(false);
    });

    it('rejects non-numeric strings', () => {
      expect(
        RefundAckPayloadSchema.safeParse({ ...VALID_PAYLOAD, amountRefunded: 'abc' }).success
      ).toBe(false);
      expect(RefundAckPayloadSchema.safeParse({ ...VALID_PAYLOAD, refundFee: '' }).success).toBe(
        false
      );
    });

    it('rejects amounts exceeding 40 characters', () => {
      expect(
        RefundAckPayloadSchema.safeParse({ ...VALID_PAYLOAD, amountRefunded: '1'.repeat(41) })
          .success
      ).toBe(false);
      expect(
        RefundAckPayloadSchema.safeParse({ ...VALID_PAYLOAD, refundFee: '1'.repeat(41) }).success
      ).toBe(false);
    });
  });

  describe('payments array validation', () => {
    it('rejects more than 20 payments', () => {
      const twentyOnePayments = Array.from({ length: 21 }, (_, i) => ({
        id: `pay_${i}`,
        idType: 'stellar' as const,
        amount: '1.00',
      }));
      expect(
        RefundAckPayloadSchema.safeParse({ ...VALID_PAYLOAD, payments: twentyOnePayments }).success
      ).toBe(false);
    });

    it('rejects payments with invalid idType', () => {
      const invalidPayment = {
        ...VALID_PAYLOAD,
        payments: [
          {
            id: 'pay_1',
            idType: 'crypto' as never,
            amount: '50.00',
          },
        ],
      };
      expect(RefundAckPayloadSchema.safeParse(invalidPayment).success).toBe(false);
    });

    it('rejects payments with empty or overlong id', () => {
      expect(
        RefundAckPaymentSchema.safeParse({ id: '', idType: 'stellar', amount: '10' }).success
      ).toBe(false);
      expect(
        RefundAckPaymentSchema.safeParse({
          id: 'x'.repeat(129),
          idType: 'stellar',
          amount: '10',
        }).success
      ).toBe(false);
    });
  });
});

// ─── Builder: buildRefundAck ──────────────────────────────────────────────────

describe('buildRefundAck', () => {
  it('constructs a valid RefundAckPayload matching input values', () => {
    const built = buildRefundAck({
      intentHash: INTENT_HASH,
      anchorId: ANCHOR_ID,
      account: ACCOUNT,
      refunds: SAMPLE_REFUNDS,
    });

    expect(built.type).toBe(REFUND_ACK_TYPE);
    expect(built.version).toBe(REFUND_ACK_VERSION);
    expect(built.intentHash).toBe(INTENT_HASH);
    expect(built.anchorId).toBe(ANCHOR_ID);
    expect(built.account).toBe(ACCOUNT);
    expect(built.amountRefunded).toBe('95.00');
    expect(built.refundFee).toBe('5.00');
    expect(built.payments).toEqual([
      { id: 'pay_1', idType: 'stellar', amount: '50.00' },
      { id: 'pay_2', idType: 'external', amount: '45.00' },
    ]);
  });

  it('maps id_type to idType and drops per-payment fee', () => {
    const built = buildRefundAck({
      intentHash: INTENT_HASH,
      anchorId: ANCHOR_ID,
      account: ACCOUNT,
      refunds: SAMPLE_REFUNDS,
    });

    for (const p of built.payments) {
      expect(p).toHaveProperty('id');
      expect(p).toHaveProperty('idType');
      expect(p).toHaveProperty('amount');
      expect(p).not.toHaveProperty('fee');
      expect(p).not.toHaveProperty('id_type');
    }
  });

  it('preserves the order of payments from the input', () => {
    const reversedRefunds: Sep24Refunds = {
      ...SAMPLE_REFUNDS,
      payments: [...SAMPLE_REFUNDS.payments].reverse(),
    };
    const built = buildRefundAck({
      intentHash: INTENT_HASH,
      anchorId: ANCHOR_ID,
      account: ACCOUNT,
      refunds: reversedRefunds,
    });

    expect(built.payments[0]?.id).toBe('pay_2');
    expect(built.payments[1]?.id).toBe('pay_1');
  });

  it('built payload passes RefundAckPayloadSchema validation', () => {
    const built = buildRefundAck({
      intentHash: INTENT_HASH,
      anchorId: ANCHOR_ID,
      account: ACCOUNT,
      refunds: SAMPLE_REFUNDS,
    });

    expect(RefundAckPayloadSchema.parse(built)).toEqual(built);
  });
});

// ─── Key Sorting & Canonical Serialization ────────────────────────────────────

describe('canonicalJsonValue & Canonical Formatting', () => {
  it('sorts keys alphabetically at root and in nested payment objects', () => {
    const json = canonicalJsonValue(VALID_PAYLOAD);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    // Root keys sorted
    expect(Object.keys(parsed)).toEqual([
      'account',
      'amountRefunded',
      'anchorId',
      'intentHash',
      'payments',
      'refundFee',
      'type',
      'version',
    ]);

    // Payment object keys sorted
    const payments = parsed.payments as Array<Record<string, unknown>>;
    for (const p of payments) {
      expect(Object.keys(p)).toEqual(['amount', 'id', 'idType']);
    }
  });

  it('produces identical canonical JSON regardless of root key order', () => {
    const shuffled: RefundAckPayload = {
      payments: VALID_PAYLOAD.payments,
      version: VALID_PAYLOAD.version,
      type: VALID_PAYLOAD.type,
      refundFee: VALID_PAYLOAD.refundFee,
      account: VALID_PAYLOAD.account,
      amountRefunded: VALID_PAYLOAD.amountRefunded,
      anchorId: VALID_PAYLOAD.anchorId,
      intentHash: VALID_PAYLOAD.intentHash,
    };

    expect(canonicalJsonValue(shuffled)).toBe(canonicalJsonValue(VALID_PAYLOAD));
  });

  it('preserves array order in canonical JSON (payment order is significant)', () => {
    const reversedPayments: RefundAckPayload = {
      ...VALID_PAYLOAD,
      payments: [...VALID_PAYLOAD.payments].reverse(),
    };

    expect(canonicalJsonValue(reversedPayments)).not.toBe(canonicalJsonValue(VALID_PAYLOAD));
  });
});

// ─── Hashing & Hash Determinism ───────────────────────────────────────────────

describe('hashRefundAck', () => {
  it('returns a 64-character lowercase hex string', async () => {
    const hash = await hashRefundAck(VALID_PAYLOAD);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces identical hash for payloads with different key orders', async () => {
    const shuffled: RefundAckPayload = {
      payments: VALID_PAYLOAD.payments,
      refundFee: VALID_PAYLOAD.refundFee,
      amountRefunded: VALID_PAYLOAD.amountRefunded,
      version: VALID_PAYLOAD.version,
      account: VALID_PAYLOAD.account,
      anchorId: VALID_PAYLOAD.anchorId,
      intentHash: VALID_PAYLOAD.intentHash,
      type: VALID_PAYLOAD.type,
    };

    const h1 = await hashRefundAck(VALID_PAYLOAD);
    const h2 = await hashRefundAck(shuffled);
    expect(h1).toBe(h2);
  });

  it('delegates to hashCanonical', async () => {
    const h1 = await hashRefundAck(VALID_PAYLOAD);
    const h2 = await hashCanonical(VALID_PAYLOAD);
    expect(h1).toBe(h2);
  });

  it('produces different hash when amountRefunded changes', async () => {
    const modified = { ...VALID_PAYLOAD, amountRefunded: '94.00' };
    expect(await hashRefundAck(modified)).not.toBe(await hashRefundAck(VALID_PAYLOAD));
  });

  it('produces different hash when refundFee changes', async () => {
    const modified = { ...VALID_PAYLOAD, refundFee: '6.00' };
    expect(await hashRefundAck(modified)).not.toBe(await hashRefundAck(VALID_PAYLOAD));
  });

  it('produces different hash when payment array order changes', async () => {
    const modified = {
      ...VALID_PAYLOAD,
      payments: [...VALID_PAYLOAD.payments].reverse(),
    };
    expect(await hashRefundAck(modified)).not.toBe(await hashRefundAck(VALID_PAYLOAD));
  });
});

// ─── Backward Compatibility: Intent Fixtures ──────────────────────────────────

describe('canonicalJsonValue & hashCanonical backward compatibility', () => {
  const BASE_INTENT = {
    type: 'offramp',
    sourceAsset: 'USDC',
    destinationAsset: 'NGN',
    amount: '100',
    sender: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ012345678901234567890123456789',
    recipient: 'NGN-BANK-ACCOUNT-123',
  };

  const PINNED_INTENT_HASH = 'f24f63585861ffb5fc8d06ddb5d572215650e15332831af81f62a71b056b562e';

  it('pins BASE_INTENT to the exact fixture hash', async () => {
    const hash = await hashCanonical(BASE_INTENT);
    expect(hash).toBe(PINNED_INTENT_HASH);
  });

  it('hashCanonical(intent) matches hashIntent(intent)', async () => {
    expect(await hashCanonical(BASE_INTENT)).toBe(await hashIntent(BASE_INTENT));
  });

  it('canonicalJsonValue(intent) matches canonicalJson(intent)', () => {
    expect(canonicalJsonValue(BASE_INTENT)).toBe(canonicalJson(BASE_INTENT));
  });
});
