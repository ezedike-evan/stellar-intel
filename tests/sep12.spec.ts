import { describe, expect, it } from 'vitest';
import { resolveKycFields, type KycFieldDescriptor } from '@/lib/stellar/sep12';

const customerResponse = {
  status: 'NEEDS_INFO',
  fields: {
    first_name: { type: 'string', description: 'First name' },
    last_name: { type: 'string', description: 'Last name' },
    photo_id_front: { type: 'binary', description: 'ID front' },
    birth_date: { type: 'date', description: 'Birth date', optional: true },
  },
};

const withdrawResponse = {
  type: 'non_interactive_customer_info_needed',
  fields: ['first_name', 'last_name', 'photo_id_front'],
};

describe('resolveKycFields', () => {
  it('returns all 4 fields with correct types', () => {
    const result = resolveKycFields(withdrawResponse, customerResponse);

    expect(result).toHaveLength(4);

    const byKey = Object.fromEntries(result.map((f) => [f.key, f]));

    expect(byKey['first_name']!.type).toBe('string');
    expect(byKey['last_name']!.type).toBe('string');
    expect(byKey['photo_id_front']!.type).toBe('binary');
    expect(byKey['birth_date']!.type).toBe('date');
  });

  it('marks optional field as not required', () => {
    const result = resolveKycFields(withdrawResponse, customerResponse);
    const byKey = Object.fromEntries(result.map((f) => [f.key, f]));

    expect(byKey['birth_date']!.required).toBe(false);
    expect(byKey['first_name']!.required).toBe(true);
    expect(byKey['last_name']!.required).toBe(true);
    expect(byKey['photo_id_front']!.required).toBe(true);
  });

  it('deduplicates when same field appears in both responses', () => {
    const result = resolveKycFields(withdrawResponse, customerResponse);
    const keys = result.map((f) => f.key);

    expect(keys.filter((k) => k === 'first_name')).toHaveLength(1);
    expect(keys.filter((k) => k === 'last_name')).toHaveLength(1);
    expect(keys.filter((k) => k === 'photo_id_front')).toHaveLength(1);
  });

  it('customer response wins for type and description on duplicate keys', () => {
    const withdraw = { fields: ['photo_id_front'] };
    const customer = {
      fields: {
        photo_id_front: { type: 'binary', description: 'ID front' },
      },
    };

    const result = resolveKycFields(withdraw, customer);
    const field = result.find((f) => f.key === 'photo_id_front') as KycFieldDescriptor;

    expect(field.type).toBe('binary');
    expect(field.description).toBe('ID front');
  });

  it('places required fields before optional ones', () => {
    const result = resolveKycFields(withdrawResponse, customerResponse);

    const firstOptionalIndex = result.findIndex((f) => !f.required);
    const lastRequiredIndex = result.reduce((acc, f, i) => (f.required ? i : acc), -1);

    if (firstOptionalIndex !== -1 && lastRequiredIndex !== -1) {
      expect(lastRequiredIndex).toBeLessThan(firstOptionalIndex);
    }
  });

  it('falls back to type=string and required=true for withdraw-only fields', () => {
    const result = resolveKycFields({ fields: ['unknown_field'] }, {});
    const field = result.find((f) => f.key === 'unknown_field') as KycFieldDescriptor;

    expect(field.type).toBe('string');
    expect(field.required).toBe(true);
    expect(field.description).toBeUndefined();
  });
});
