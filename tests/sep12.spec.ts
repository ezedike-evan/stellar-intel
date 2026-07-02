import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  resolveKycFields,
  putCustomer,
  getCustomer,
  type KycFieldDescriptor,
} from '@/lib/stellar/sep12';

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

describe('putCustomer', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('sends PUT to /customer with JWT and fields, returns normalized response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'cust-123',
        status: 'NEEDS_INFO',
        fields: {
          first_name: { description: 'First name', type: 'string' },
        },
      }),
    } as Response);

    const result = await putCustomer('https://kyc.anchor.test', 'jwt-token', {
      first_name: 'John',
    });

    expect(fetch).toHaveBeenCalledWith('https://kyc.anchor.test/customer', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer jwt-token',
      },
      body: JSON.stringify({ first_name: 'John' }),
    });
    expect(result.id).toBe('cust-123');
    expect(result.status).toBe('NEEDS_INFO');
    expect(result.fields?.['first_name']?.description).toBe('First name');
  });

  it('normalizes unknown status to NEEDS_INFO', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'UNKNOWN_STATUS' }),
    } as Response);

    const result = await putCustomer('https://kyc.anchor.test', 'jwt', {});
    expect(result.status).toBe('NEEDS_INFO');
  });

  it('throws on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    } as Response);

    await expect(putCustomer('https://kyc.anchor.test', 'jwt', {})).rejects.toThrow();
  });
});

describe('getCustomer', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('sends GET to /customer with JWT, returns normalized response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'cust-456', status: 'ACCEPTED' }),
    } as Response);

    const result = await getCustomer('https://kyc.anchor.test', 'jwt-token');

    const calledUrl = (vi.mocked(fetch).mock.calls[0] as unknown[])[0] as string;
    expect(calledUrl).toContain('/customer');
    expect(result.status).toBe('ACCEPTED');
    expect(result.id).toBe('cust-456');
  });

  it('appends id param when provided', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'PROCESSING' }),
    } as Response);

    await getCustomer('https://kyc.anchor.test', 'jwt', 'cust-789');

    const calledUrl = (vi.mocked(fetch).mock.calls[0] as unknown[])[0] as string;
    expect(calledUrl).toContain('id=cust-789');
  });

  it('throws on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found' }),
    } as Response);

    await expect(getCustomer('https://kyc.anchor.test', 'jwt')).rejects.toThrow();
  });
});
