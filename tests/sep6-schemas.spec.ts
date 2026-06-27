import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Sep6InfoSchema } from '@/lib/stellar/sep6-schemas';

// A representative SEP-6 GET /info payload in the shape Cowrie (NGN anchor)
// publishes: an enabled NGN deposit/withdraw with fees, limits, and the KYC
// fields the programmatic API requires, plus the simple endpoint flags.
const COWRIE_INFO_RESPONSE = {
  deposit: {
    NGN: {
      enabled: true,
      authentication_required: true,
      fee_fixed: 0,
      fee_percent: 1.5,
      min_amount: 100,
      max_amount: 5000000,
      fields: {
        type: {
          description: 'type of deposit to make',
          choices: ['bank_account', 'cash'],
        },
        email_address: {
          description: 'your email address for transaction status updates',
          optional: true,
        },
      },
    },
  },
  withdraw: {
    NGN: {
      enabled: true,
      authentication_required: true,
      fee_fixed: 5,
      fee_percent: 0,
      min_amount: 100,
      max_amount: 5000000,
      fields: {
        bank_account_number: { description: 'bank account number of the destination' },
        bank_number: { description: 'bank routing number of the destination bank' },
      },
    },
  },
  fee: { enabled: false },
  transactions: { enabled: true, authentication_required: true },
  transaction: { enabled: true, authentication_required: true },
};

describe('Sep6InfoSchema', () => {
  it('parses a real Cowrie /info payload', () => {
    const info = Sep6InfoSchema.parse(COWRIE_INFO_RESPONSE);

    expect(info.deposit.NGN?.enabled).toBe(true);
    expect(info.deposit.NGN?.fee_percent).toBe(1.5);
    expect(info.deposit.NGN?.fields?.type?.choices).toEqual(['bank_account', 'cash']);
    expect(info.withdraw.NGN?.fee_fixed).toBe(5);
    expect(info.withdraw.NGN?.fields?.bank_account_number?.description).toContain('account number');
    expect(info.fee?.enabled).toBe(false);
  });

  it('defaults missing deposit/withdraw maps to empty objects', () => {
    const info = Sep6InfoSchema.parse({});

    expect(info.deposit).toEqual({});
    expect(info.withdraw).toEqual({});
  });

  it('throws a ZodError when an asset entry omits the required "enabled" flag', () => {
    const invalid = { deposit: { NGN: { fee_fixed: 5 } } };

    expect(() => Sep6InfoSchema.parse(invalid)).toThrow(z.ZodError);
  });

  it('throws a ZodError when a numeric fee is sent as a string', () => {
    const invalid = { withdraw: { NGN: { enabled: true, fee_fixed: '5' } } };

    expect(() => Sep6InfoSchema.parse(invalid)).toThrow(z.ZodError);
  });
});
