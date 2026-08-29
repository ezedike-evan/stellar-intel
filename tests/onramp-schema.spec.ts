import { describe, it, expect } from 'vitest';
import { OnrampIntentSchema, ONRAMP_DEPOSIT_METHODS } from '@/lib/intent/onramp-schema';
import type { OnrampIntent } from '@/lib/intent/onramp-schema';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DESTINATION = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const VALID: OnrampIntent = {
  type: 'onramp',
  sourceAsset: 'NGN',
  destinationAsset: 'USDC',
  amount: '150000.00',
  sender: 'NG123456789012345678',
  destination: DESTINATION,
  depositMethod: 'bank_transfer',
};

// ─── Round-trip ───────────────────────────────────────────────────────────────

describe('OnrampIntentSchema round-trip', () => {
  it('parses a representative deposit intent and preserves all fields', () => {
    expect(OnrampIntentSchema.parse(VALID)).toEqual(VALID);
  });

  it('round-trips through JSON serialisation', () => {
    const restored = OnrampIntentSchema.parse(JSON.parse(JSON.stringify(VALID)) as unknown);
    expect(restored).toEqual(VALID);
  });

  it('leaves memo and memoType undefined when neither is supplied', () => {
    const result = OnrampIntentSchema.parse(VALID);
    expect(result.memo).toBeUndefined();
    expect(result.memoType).toBeUndefined();
  });

  it('accepts every supported deposit method', () => {
    for (const depositMethod of ONRAMP_DEPOSIT_METHODS) {
      expect(OnrampIntentSchema.parse({ ...VALID, depositMethod }).depositMethod).toBe(
        depositMethod
      );
    }
  });
});

// ─── Field validation ─────────────────────────────────────────────────────────

describe('OnrampIntentSchema field validation', () => {
  it('rejects a malformed intent that is missing required fields', () => {
    const result = OnrampIntentSchema.safeParse({ type: 'onramp', amount: '100' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toEqual(
        expect.arrayContaining([
          'sourceAsset',
          'destinationAsset',
          'sender',
          'destination',
          'depositMethod',
        ])
      );
    }
  });

  it('rejects the off-ramp discriminator', () => {
    expect(OnrampIntentSchema.safeParse({ ...VALID, type: 'offramp' }).success).toBe(false);
  });

  it('rejects an empty sourceAsset', () => {
    expect(OnrampIntentSchema.safeParse({ ...VALID, sourceAsset: '' }).success).toBe(false);
  });

  it('rejects an empty destinationAsset', () => {
    expect(OnrampIntentSchema.safeParse({ ...VALID, destinationAsset: '' }).success).toBe(false);
  });

  it('rejects a zero amount', () => {
    expect(OnrampIntentSchema.safeParse({ ...VALID, amount: '0' }).success).toBe(false);
  });

  it('rejects a negative amount', () => {
    expect(OnrampIntentSchema.safeParse({ ...VALID, amount: '-5' }).success).toBe(false);
  });

  it('rejects a non-numeric amount', () => {
    expect(OnrampIntentSchema.safeParse({ ...VALID, amount: 'lots' }).success).toBe(false);
  });

  it('rejects an empty sender', () => {
    expect(OnrampIntentSchema.safeParse({ ...VALID, sender: '' }).success).toBe(false);
  });

  it('rejects an unknown deposit method', () => {
    expect(
      OnrampIntentSchema.safeParse({ ...VALID, depositMethod: 'carrier_pigeon' }).success
    ).toBe(false);
  });
});

// ─── Destination (diverges from the off-ramp recipient) ───────────────────────

describe('OnrampIntentSchema destination', () => {
  it('rejects a bank-account style destination that the off-ramp would accept', () => {
    const result = OnrampIntentSchema.safeParse({ ...VALID, destination: 'NG12345678901234' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path.join('.')).toBe('destination');
    }
  });

  it('rejects a muxed (M…) account', () => {
    expect(
      OnrampIntentSchema.safeParse({
        ...VALID,
        destination: `M${DESTINATION.slice(1)}`,
      }).success
    ).toBe(false);
  });

  it('rejects a strkey containing characters outside the base32 alphabet', () => {
    expect(
      OnrampIntentSchema.safeParse({ ...VALID, destination: `GA0${DESTINATION.slice(3)}` }).success
    ).toBe(false);
  });

  it('rejects a truncated public key', () => {
    expect(
      OnrampIntentSchema.safeParse({ ...VALID, destination: DESTINATION.slice(0, 40) }).success
    ).toBe(false);
  });
});

// ─── Memo pairing and encoding ────────────────────────────────────────────────

describe('OnrampIntentSchema memo', () => {
  it('accepts a text memo within the 28-byte limit', () => {
    const intent = { ...VALID, memo: 'deposit-9f21', memoType: 'text' as const };
    expect(OnrampIntentSchema.parse(intent)).toEqual(intent);
  });

  it('requires memoType when memo is present', () => {
    const result = OnrampIntentSchema.safeParse({ ...VALID, memo: 'deposit-9f21' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path.join('.')).toBe('memoType');
    }
  });

  it('requires memo when memoType is present', () => {
    const result = OnrampIntentSchema.safeParse({ ...VALID, memoType: 'text' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path.join('.')).toBe('memo');
    }
  });

  it('rejects an empty memo', () => {
    expect(OnrampIntentSchema.safeParse({ ...VALID, memo: '', memoType: 'text' }).success).toBe(
      false
    );
  });

  it('rejects a text memo longer than 28 bytes', () => {
    expect(
      OnrampIntentSchema.safeParse({ ...VALID, memo: 'x'.repeat(29), memoType: 'text' }).success
    ).toBe(false);
  });

  it('rejects a text memo that is 28 characters but over 28 bytes once encoded', () => {
    expect(
      OnrampIntentSchema.safeParse({ ...VALID, memo: 'é'.repeat(28), memoType: 'text' }).success
    ).toBe(false);
  });

  it('accepts an id memo at the uint64 ceiling', () => {
    expect(
      OnrampIntentSchema.safeParse({
        ...VALID,
        memo: '18446744073709551615',
        memoType: 'id',
      }).success
    ).toBe(true);
  });

  it('rejects an id memo above the uint64 ceiling', () => {
    expect(
      OnrampIntentSchema.safeParse({
        ...VALID,
        memo: '18446744073709551616',
        memoType: 'id',
      }).success
    ).toBe(false);
  });

  it('rejects a non-numeric id memo', () => {
    expect(OnrampIntentSchema.safeParse({ ...VALID, memo: '12ab', memoType: 'id' }).success).toBe(
      false
    );
  });

  it('accepts a 64-character lowercase hex hash memo', () => {
    expect(
      OnrampIntentSchema.safeParse({ ...VALID, memo: 'a'.repeat(64), memoType: 'hash' }).success
    ).toBe(true);
  });

  it('rejects a hash memo of the wrong length', () => {
    expect(
      OnrampIntentSchema.safeParse({ ...VALID, memo: 'a'.repeat(63), memoType: 'hash' }).success
    ).toBe(false);
  });

  it('rejects an uppercase hash memo', () => {
    expect(
      OnrampIntentSchema.safeParse({ ...VALID, memo: 'A'.repeat(64), memoType: 'hash' }).success
    ).toBe(false);
  });
});
