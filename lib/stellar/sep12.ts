import { parseSepErrorBody } from './errors';
import type { CustomerStatus, Sep12CustomerField, Sep12CustomerResponse } from '@/types';

export type KycFieldType = 'string' | 'binary' | 'date';

export interface KycFieldDescriptor {
  key: string;
  type: KycFieldType;
  required: boolean;
  description?: string;
}

function normalizeCustomerStatus(raw: unknown): CustomerStatus {
  if (raw === 'ACCEPTED' || raw === 'NEEDS_INFO' || raw === 'PROCESSING' || raw === 'REJECTED') {
    return raw;
  }
  return 'NEEDS_INFO';
}

function parseCustomerBody(data: Record<string, unknown>): Sep12CustomerResponse {
  return {
    ...(typeof data['id'] === 'string' ? { id: data['id'] } : {}),
    status: normalizeCustomerStatus(data['status']),
    ...(data['fields'] != null
      ? { fields: data['fields'] as Record<string, Sep12CustomerField> }
      : {}),
    ...(data['provided_fields'] != null
      ? { provided_fields: data['provided_fields'] as Record<string, Sep12CustomerField> }
      : {}),
    ...(typeof data['message'] === 'string' ? { message: data['message'] } : {}),
  };
}

export async function putCustomer(
  kycServer: string,
  jwt: string,
  fields: Record<string, string>
): Promise<Sep12CustomerResponse> {
  const res = await fetch(`${kycServer}/customer`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(fields),
  });

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    throw parseSepErrorBody(body, res.status);
  }

  const data = (await res.json()) as Record<string, unknown>;
  return parseCustomerBody(data);
}

export async function getCustomer(
  kycServer: string,
  jwt: string,
  id?: string
): Promise<Sep12CustomerResponse> {
  const url = new URL(`${kycServer}/customer`);
  if (id) url.searchParams.set('id', id);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    throw parseSepErrorBody(body, res.status);
  }

  const data = (await res.json()) as Record<string, unknown>;
  return parseCustomerBody(data);
}

interface CustomerField {
  type?: string;
  description?: string;
  optional?: boolean;
}

function toKycFieldType(raw: unknown): KycFieldType {
  if (raw === 'binary' || raw === 'date') return raw;
  return 'string';
}

export function resolveKycFields(
  withdrawResponse: Record<string, unknown>,
  customerResponse: Record<string, unknown>
): KycFieldDescriptor[] {
  const map = new Map<string, KycFieldDescriptor>();

  const withdrawFields = withdrawResponse['fields'];
  if (Array.isArray(withdrawFields)) {
    for (const key of withdrawFields) {
      if (typeof key === 'string') {
        map.set(key, { key, type: 'string', required: true });
      }
    }
  }

  const customerFields = customerResponse['fields'];
  if (
    customerFields !== null &&
    typeof customerFields === 'object' &&
    !Array.isArray(customerFields)
  ) {
    for (const [key, raw] of Object.entries(customerFields as Record<string, unknown>)) {
      const field = raw as CustomerField;
      map.set(key, {
        key,
        type: toKycFieldType(field?.type),
        required: field?.optional !== true,
        ...(field?.description !== undefined ? { description: field.description } : {}),
      });
    }
  }

  const descriptors = Array.from(map.values());
  return descriptors.sort((a, b) => {
    if (a.required === b.required) return 0;
    return a.required ? -1 : 1;
  });
}
