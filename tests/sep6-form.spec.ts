import { describe, expect, it } from 'vitest';
import { buildSep6FormSchema } from '@/lib/stellar/sep6-form';

const fourFieldDescriptor = {
  full_name: { description: 'Full name' },
  bank_account: { description: 'Bank account number' },
  routing_number: { description: 'Routing number' },
  account_type: {
    description: 'Account type',
    choices: ['checking', 'savings'],
  },
};

describe('buildSep6FormSchema', () => {
  it('produces one form field per descriptor key', () => {
    const { fields } = buildSep6FormSchema(fourFieldDescriptor);
    expect(fields).toHaveLength(4);
  });

  it('sets type=select for fields with choices', () => {
    const { fields } = buildSep6FormSchema(fourFieldDescriptor);
    const accountType = fields.find((f) => f.key === 'account_type');
    expect(accountType?.type).toBe('select');
    expect(accountType?.choices).toEqual(['checking', 'savings']);
  });

  it('sets type=text for fields without choices', () => {
    const { fields } = buildSep6FormSchema(fourFieldDescriptor);
    const fullName = fields.find((f) => f.key === 'full_name');
    expect(fullName?.type).toBe('text');
    expect(fullName?.choices).toBeUndefined();
  });

  it('marks non-optional fields as required', () => {
    const { fields } = buildSep6FormSchema(fourFieldDescriptor);
    expect(fields.every((f) => f.required)).toBe(true);
  });

  it('marks optional fields as not required', () => {
    const { fields } = buildSep6FormSchema({
      memo: { description: 'Optional memo', optional: true },
    });
    expect(fields[0]?.required).toBe(false);
  });

  it('uses description as label', () => {
    const { fields } = buildSep6FormSchema(fourFieldDescriptor);
    const fullName = fields.find((f) => f.key === 'full_name');
    expect(fullName?.label).toBe('Full name');
  });

  it('valid data passes schema parse', () => {
    const { schema } = buildSep6FormSchema(fourFieldDescriptor);
    const result = schema.safeParse({
      full_name: 'John Doe',
      bank_account: '123456789',
      routing_number: '021000021',
      account_type: 'checking',
    });
    expect(result.success).toBe(true);
  });

  it('missing required field fails schema parse', () => {
    const { schema } = buildSep6FormSchema(fourFieldDescriptor);
    const result = schema.safeParse({
      full_name: '',
      bank_account: '123456789',
      routing_number: '021000021',
      account_type: 'checking',
    });
    expect(result.success).toBe(false);
  });

  it('invalid enum value fails schema parse', () => {
    const { schema } = buildSep6FormSchema(fourFieldDescriptor);
    const result = schema.safeParse({
      full_name: 'John Doe',
      bank_account: '123456789',
      routing_number: '021000021',
      account_type: 'wire',
    });
    expect(result.success).toBe(false);
  });

  it('optional field missing is valid', () => {
    const { schema } = buildSep6FormSchema({
      name: { description: 'Name' },
      memo: { description: 'Memo', optional: true },
    });
    const result = schema.safeParse({ name: 'Jane' });
    expect(result.success).toBe(true);
  });
});
