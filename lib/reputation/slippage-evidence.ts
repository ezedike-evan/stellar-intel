import type { SlippageEvidence, SlippageOnChainEvidence } from '@/types/reputation';

/**
 * Sorts object keys recursively so JSON serialization is deterministic
 * across environments, property declaration orders, and nesting levels.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys(obj[key]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * Serializes any value to canonical JSON: sorted keys recursively,
 * no whitespace.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/**
 * Serializes slippage evidence to canonical JSON for deterministic SHA-256 hashing.
 */
export function canonicalEvidenceJson(evidence: SlippageEvidence): string {
  return canonicalize(evidence);
}

/**
 * Computes the lowercase hex SHA-256 digest of the canonical evidence JSON.
 */
export async function hashSlippageEvidence(evidence: SlippageEvidence): Promise<string> {
  const canonical = canonicalEvidenceJson(evidence);
  const encoded = new TextEncoder().encode(canonical);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Attaches on-chain evidence to an existing SlippageEvidence object,
 * returning a new immutable copy.
 */
export function withOnChainEvidence(
  evidence: SlippageEvidence,
  onChain: SlippageOnChainEvidence
): SlippageEvidence {
  return {
    ...evidence,
    onChain: { ...onChain },
  };
}
