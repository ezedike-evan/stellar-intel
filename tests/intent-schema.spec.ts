import { describe, it, expect } from 'vitest';
import { IntentV1Schema } from '@/lib/intent/schema';
import type { IntentV1 } from '@/lib/intent/schema';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID: IntentV1 = {
  id: 'intent-001',
  from: 'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  to: 'iso4217:NGN',
  amount: '100.00',
  floor: '45000.00',
  deadline: '2026-12-31T23:59:59Z',
  recipient: 'NG123456789012345678',
  nonce: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
};

// ─── Round-trip ───────────────────────────────────────────────────────────────

describe('IntentV1Schema round-trip', () => {
  it('parses a valid intent and preserves all fields', () => {
    const result = IntentV1Schema.parse(VALID);
    expect(result).toEqual(VALID);
  });

  it('accepts optional metadata and preserves it', () => {
    const withMeta: IntentV1 = {
      ...VALID,
      metadata: { deliveryMethod: 'bank_account', priority: 1 },
    };
    const result = IntentV1Schema.parse(withMeta);
    expect(result.metadata).toEqual({ deliveryMethod: 'bank_account', priority: 1 });
  });

  it('omits metadata when not provided', () => {
    const result = IntentV1Schema.parse(VALID);
    expect(result.metadata).toBeUndefined();
  });

  it('round-trips through JSON serialisation', () => {
    const serialised = JSON.stringify(VALID);
    const restored = IntentV1Schema.parse(JSON.parse(serialised) as unknown);
    expect(restored).toEqual(VALID);
  });
});

// ─── Field validation ─────────────────────────────────────────────────────────

describe('IntentV1Schema field validation', () => {
  it('rejects missing id', () => {
    const { id: _omit, ...rest } = VALID;
    expect(() => IntentV1Schema.parse(rest)).toThrow();
  });

  it('rejects empty id', () => {
    expect(() => IntentV1Schema.parse({ ...VALID, id: '' })).toThrow();
  });

  it('rejects missing from', () => {
    const { from: _omit, ...rest } = VALID;
    expect(() => IntentV1Schema.parse(rest)).toThrow();
  });

  it('rejects missing to', () => {
    const { to: _omit, ...rest } = VALID;
    expect(() => IntentV1Schema.parse(rest)).toThrow();
  });

  it('rejects zero amount', () => {
    expect(() => IntentV1Schema.parse({ ...VALID, amount: '0' })).toThrow();
  });

  it('rejects negative amount string', () => {
    expect(() => IntentV1Schema.parse({ ...VALID, amount: '-5' })).toThrow();
  });

  it('rejects non-numeric amount', () => {
    expect(() => IntentV1Schema.parse({ ...VALID, amount: 'abc' })).toThrow();
  });

  it('rejects negative floor', () => {
    expect(() => IntentV1Schema.parse({ ...VALID, floor: '-1' })).toThrow();
  });

  it('accepts zero floor', () => {
    expect(() => IntentV1Schema.parse({ ...VALID, floor: '0' })).not.toThrow();
  });

  it('rejects an invalid deadline (not RFC 3339)', () => {
    expect(() => IntentV1Schema.parse({ ...VALID, deadline: '31-12-2026' })).toThrow();
  });

  it('rejects missing recipient', () => {
    const { recipient: _omit, ...rest } = VALID;
    expect(() => IntentV1Schema.parse(rest)).toThrow();
  });

  it('rejects a nonce that is not 32 hex chars', () => {
    expect(() => IntentV1Schema.parse({ ...VALID, nonce: 'tooshort' })).toThrow();
  });

  it('rejects a nonce with non-hex characters', () => {
    expect(() =>
      IntentV1Schema.parse({ ...VALID, nonce: 'z1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4' })
    ).toThrow();
  });
});

// ─── Typed error shape ────────────────────────────────────────────────────────

describe('IntentV1Schema typed error shape', () => {
  it('safeParse returns ok:false with ZodError on invalid input', () => {
    const result = IntentV1Schema.safeParse({ ...VALID, amount: '0' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
      expect(result.error.issues[0]?.path).toBeDefined();
    }
  });

  it('safeParse returns ok:true with the parsed value on valid input', () => {
    const result = IntentV1Schema.safeParse(VALID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(VALID);
    }
  });

  it('error path identifies the offending field', () => {
    const result = IntentV1Schema.safeParse({ ...VALID, nonce: 'bad' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('nonce');
    }
  });
});
