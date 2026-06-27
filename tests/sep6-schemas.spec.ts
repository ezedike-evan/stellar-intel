import { describe, it, expect } from 'vitest';
import {
  Sep6WithdrawInteractiveSchema,
  Sep6WithdrawNonInteractiveSchema,
  Sep6WithdrawNeedsInfoSchema,
  Sep6WithdrawResponseSchema,
} from '@/lib/stellar/sep6-schemas';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const INTERACTIVE_FIXTURE = {
  type: 'interactive_customer_info_needed' as const,
  url: 'https://anchor.example.com/sep6/interactive',
  id: 'tx-001',
};

const NON_INTERACTIVE_FIXTURE = {
  type: 'non_interactive' as const,
  id: 'tx-002',
  eta: 300,
  min_amount: 10,
  max_amount: 10000,
  amount_in: '100.00',
  amount_out: '98.50',
  amount_fee: '1.50',
  extra_info: { message: 'Processing in 5 minutes.' },
};

const NEEDS_INFO_FIXTURE = {
  type: 'customer_info_status' as const,
  fields: {
    bank_account: { description: 'Your bank account number', optional: false },
    bank_routing: { description: 'Your bank routing number' },
    dest_extra: {
      description: 'Destination tag',
      choices: ['savings', 'checking'],
      optional: true,
    },
  },
};

// ─── Sep6WithdrawInteractiveSchema ────────────────────────────────────────────

describe('Sep6WithdrawInteractiveSchema', () => {
  it('parses a valid interactive fixture', () => {
    const result = Sep6WithdrawInteractiveSchema.safeParse(INTERACTIVE_FIXTURE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(INTERACTIVE_FIXTURE);
    }
  });

  it('rejects a payload missing url', () => {
    const { url: _omit, ...rest } = INTERACTIVE_FIXTURE;
    expect(Sep6WithdrawInteractiveSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a payload with a non-URL url string', () => {
    const result = Sep6WithdrawInteractiveSchema.safeParse({
      ...INTERACTIVE_FIXTURE,
      url: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a payload missing id', () => {
    const { id: _omit, ...rest } = INTERACTIVE_FIXTURE;
    expect(Sep6WithdrawInteractiveSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a non-interactive payload', () => {
    expect(Sep6WithdrawInteractiveSchema.safeParse(NON_INTERACTIVE_FIXTURE).success).toBe(false);
  });

  it('rejects a needs_info payload', () => {
    expect(Sep6WithdrawInteractiveSchema.safeParse(NEEDS_INFO_FIXTURE).success).toBe(false);
  });
});

// ─── Sep6WithdrawNonInteractiveSchema ─────────────────────────────────────────

describe('Sep6WithdrawNonInteractiveSchema', () => {
  it('parses a valid non-interactive fixture with all optional fields', () => {
    const result = Sep6WithdrawNonInteractiveSchema.safeParse(NON_INTERACTIVE_FIXTURE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(NON_INTERACTIVE_FIXTURE);
    }
  });

  it('parses a minimal non-interactive payload (id only)', () => {
    const result = Sep6WithdrawNonInteractiveSchema.safeParse({
      type: 'non_interactive',
      id: 'tx-min',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('tx-min');
      expect(result.data.eta).toBeUndefined();
      expect(result.data.extra_info).toBeUndefined();
    }
  });

  it('rejects a payload missing id', () => {
    const { id: _omit, ...rest } = NON_INTERACTIVE_FIXTURE;
    expect(Sep6WithdrawNonInteractiveSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects eta as a float', () => {
    const result = Sep6WithdrawNonInteractiveSchema.safeParse({
      ...NON_INTERACTIVE_FIXTURE,
      eta: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an interactive payload', () => {
    expect(Sep6WithdrawNonInteractiveSchema.safeParse(INTERACTIVE_FIXTURE).success).toBe(false);
  });
});

// ─── Sep6WithdrawNeedsInfoSchema ──────────────────────────────────────────────

describe('Sep6WithdrawNeedsInfoSchema', () => {
  it('parses a valid needs_info fixture', () => {
    const result = Sep6WithdrawNeedsInfoSchema.safeParse(NEEDS_INFO_FIXTURE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fields['bank_account']?.description).toBe('Your bank account number');
      expect(result.data.fields['dest_extra']?.choices).toEqual(['savings', 'checking']);
      expect(result.data.fields['bank_routing']?.optional).toBeUndefined();
    }
  });

  it('parses fields with no optional or choices (all optional omitted)', () => {
    const result = Sep6WithdrawNeedsInfoSchema.safeParse({
      type: 'customer_info_status',
      fields: {
        email: { description: 'Your email address' },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a field entry missing description', () => {
    const result = Sep6WithdrawNeedsInfoSchema.safeParse({
      type: 'customer_info_status',
      fields: {
        bad_field: { optional: true },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an interactive payload', () => {
    expect(Sep6WithdrawNeedsInfoSchema.safeParse(INTERACTIVE_FIXTURE).success).toBe(false);
  });
});

// ─── Sep6WithdrawResponseSchema (discriminated union) ─────────────────────────

describe('Sep6WithdrawResponseSchema', () => {
  it('discriminates the interactive shape', () => {
    const result = Sep6WithdrawResponseSchema.safeParse(INTERACTIVE_FIXTURE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('interactive_customer_info_needed');
    }
  });

  it('discriminates the non_interactive shape', () => {
    const result = Sep6WithdrawResponseSchema.safeParse(NON_INTERACTIVE_FIXTURE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('non_interactive');
    }
  });

  it('discriminates the customer_info_status (needs_info) shape', () => {
    const result = Sep6WithdrawResponseSchema.safeParse(NEEDS_INFO_FIXTURE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('customer_info_status');
    }
  });

  it('rejects an unknown type value', () => {
    const result = Sep6WithdrawResponseSchema.safeParse({
      type: 'unknown_type',
      id: 'tx-bad',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a payload with no type field', () => {
    const result = Sep6WithdrawResponseSchema.safeParse({ id: 'tx-no-type' });
    expect(result.success).toBe(false);
  });
});
