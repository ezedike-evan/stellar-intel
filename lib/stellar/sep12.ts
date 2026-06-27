export type KycFieldType = 'string' | 'binary' | 'date';

export interface KycFieldDescriptor {
  key: string;
  type: KycFieldType;
  required: boolean;
  description?: string;
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
