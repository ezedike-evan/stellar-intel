import { describe, it, expect } from 'vitest';
import { IntentV1Schema } from '@/lib/intent/schema';
import type { IntentV1 } from '@/lib/intent/schema';
import {
  CanonicalIntentV1Schema,
  OfframpIntentV1Schema,
  ChainedIntentV1Schema,
  RecurringIntentV1Schema,
} from '@/types/intent';

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

// ─── Canonical Intent V1 ──────────────────────────────────────────────────────

const BASE_V1 = {
  sourceAsset: 'USDC',
  destinationAsset: 'NGN',
  amount: '100.00',
  sender: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF',
  recipient: '0800-123-456',
};

describe('OfframpIntentV1Schema', () => {
  it('accepts a valid offramp intent', () => {
    const result = OfframpIntentV1Schema.safeParse({ kind: 'offramp', ...BASE_V1 });
    expect(result.success).toBe(true);
  });

  it('defaults schemaVersion to 1', () => {
    const result = OfframpIntentV1Schema.safeParse({ kind: 'offramp', ...BASE_V1 });
    expect(result.success && result.data.schemaVersion).toBe(1);
  });

  it('rejects a zero amount', () => {
    const result = OfframpIntentV1Schema.safeParse({ kind: 'offramp', ...BASE_V1, amount: '0' });
    expect(result.success).toBe(false);
  });

  it('rejects amount with more than 7 decimal places', () => {
    const result = OfframpIntentV1Schema.safeParse({
      kind: 'offramp',
      ...BASE_V1,
      amount: '1.00000001',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing sourceAsset', () => {
    const { sourceAsset: _s, ...rest } = BASE_V1;
    const result = OfframpIntentV1Schema.safeParse({ kind: 'offramp', ...rest });
    expect(result.success).toBe(false);
  });
});

describe('ChainedIntentV1Schema', () => {
  const HOP_A = {
    kind: 'on-ramp' as const,
    sellAsset: { code: 'XLM' },
    buyAsset: { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' },
    minReceive: '14.5',
  };
  const HOP_B = {
    kind: 'swap' as const,
    sellAsset: { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' },
    buyAsset: { code: 'NGN' },
    minReceive: '11000',
  };

  it('accepts a valid 2-hop chained intent', () => {
    const result = ChainedIntentV1Schema.safeParse({
      kind: 'chained',
      ...BASE_V1,
      hops: [HOP_A, HOP_B],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a single-hop chained intent', () => {
    const result = ChainedIntentV1Schema.safeParse({
      kind: 'chained',
      ...BASE_V1,
      hops: [HOP_A],
    });
    expect(result.success).toBe(false);
  });

  it('rejects chained intent with no hops', () => {
    const result = ChainedIntentV1Schema.safeParse({ kind: 'chained', ...BASE_V1, hops: [] });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid hop kind', () => {
    const result = ChainedIntentV1Schema.safeParse({
      kind: 'chained',
      ...BASE_V1,
      hops: [{ ...HOP_A, kind: 'borrow' }, HOP_B],
    });
    expect(result.success).toBe(false);
  });
});

describe('RecurringIntentV1Schema', () => {
  const SCHEDULE = { cron: '0 9 * * 1', count: 12 };

  it('accepts a valid recurring intent', () => {
    const result = RecurringIntentV1Schema.safeParse({
      kind: 'recurring',
      ...BASE_V1,
      schedule: SCHEDULE,
    });
    expect(result.success).toBe(true);
  });

  it('accepts recurring intent without count', () => {
    const result = RecurringIntentV1Schema.safeParse({
      kind: 'recurring',
      ...BASE_V1,
      schedule: { cron: '0 9 * * 1' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing schedule', () => {
    const result = RecurringIntentV1Schema.safeParse({ kind: 'recurring', ...BASE_V1 });
    expect(result.success).toBe(false);
  });

  it('rejects schedule with empty cron', () => {
    const result = RecurringIntentV1Schema.safeParse({
      kind: 'recurring',
      ...BASE_V1,
      schedule: { cron: '' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive count', () => {
    const result = RecurringIntentV1Schema.safeParse({
      kind: 'recurring',
      ...BASE_V1,
      schedule: { ...SCHEDULE, count: 0 },
    });
    expect(result.success).toBe(false);
  });
});

describe('CanonicalIntentV1Schema', () => {
  it('routes to offramp by kind', () => {
    const result = CanonicalIntentV1Schema.safeParse({ kind: 'offramp', ...BASE_V1 });
    expect(result.success && result.data.kind).toBe('offramp');
  });

  it('routes to chained by kind', () => {
    const hops = [
      { kind: 'on-ramp', sellAsset: { code: 'XLM' }, buyAsset: { code: 'USDC' }, minReceive: '1' },
      { kind: 'swap', sellAsset: { code: 'USDC' }, buyAsset: { code: 'NGN' }, minReceive: '800' },
    ];
    const result = CanonicalIntentV1Schema.safeParse({ kind: 'chained', ...BASE_V1, hops });
    expect(result.success && result.data.kind).toBe('chained');
  });

  it('routes to recurring by kind', () => {
    const result = CanonicalIntentV1Schema.safeParse({
      kind: 'recurring',
      ...BASE_V1,
      schedule: { cron: '0 9 * * 1' },
    });
    expect(result.success && result.data.kind).toBe('recurring');
  });

  it('rejects an unknown kind', () => {
    const result = CanonicalIntentV1Schema.safeParse({ kind: 'borrow', ...BASE_V1 });
    expect(result.success).toBe(false);
  });

  it('rejects a body missing kind', () => {
    const result = CanonicalIntentV1Schema.safeParse(BASE_V1);
    expect(result.success).toBe(false);
  });
});
