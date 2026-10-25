/** What every intent, off-ramp or on-ramp, needs to be deterministically hashed. */
export interface HashableIntent {
  type: string;
  sourceAsset: string;
  destinationAsset: string;
  amount: string;
  sender: string;
  [key: string]: unknown;
}

/** A minimal off-ramp intent that can be deterministically hashed. */
export interface Intent extends HashableIntent {
  recipient: string;
}

/**
 * Serialize an intent to canonical JSON: keys sorted alphabetically,
 * no whitespace. Non-string values are preserved as-is.
 */
export function canonicalJson(intent: HashableIntent): string {
  return JSON.stringify(sortKeys(intent));
}

/**
 * SHA-256 hash of the canonical JSON, returned as lowercase hex.
 * Uses the Web Crypto API so it works in both browser and Node.js 20+.
 */
export async function hashIntent(intent: HashableIntent): Promise<string> {
  const canonical = canonicalJson(intent);
  const encoded = new TextEncoder().encode(canonical);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeys(obj[k]);
        return acc;
      }, {});
  }
  return value;
}
