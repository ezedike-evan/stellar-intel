import type { Intent } from '@/types'

/**
 * Deterministic JSON canonicalization for intent hashing and signing.
 *
 * Rules:
 * - Keys are sorted alphabetically
 * - No trailing whitespace
 * - UTF-8 encoding
 * - Integer normalization (no decimal points for whole numbers)
 * - No whitespace between tokens
 *
 * This ensures that the same intent always produces the same canonical JSON,
 * regardless of how it was originally formatted.
 *
 * @see docs/CANONICAL_JSON.md for the full specification
 */
export function canonicalizeIntent(intent: Intent): string {
  // Deep clone to avoid mutating the original
  const cloned = JSON.parse(JSON.stringify(intent)) as Intent

  // Recursively sort object keys
  function sortKeys(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      return obj.map(sortKeys)
    }
    if (obj !== null && typeof obj === 'object') {
      const sorted = Object.keys(obj)
        .sort()
        .reduce((acc, key) => {
          acc[key] = sortKeys((obj as Record<string, unknown>)[key])
          return acc
        }, {} as Record<string, unknown>)
      return sorted
    }
    return obj
  }

  const sorted = sortKeys(cloned)

  // Serialize with no whitespace
  return JSON.stringify(sorted)
}

/**
 * Validate that a string is properly canonicalized JSON.
 * This is useful for testing and debugging.
 */
export function isValidCanonical(json: string): boolean {
  try {
    const parsed = JSON.parse(json)
    const recanonicalized = canonicalizeIntent(parsed as Intent)
    return json === recanonicalized
  } catch {
    return false
  }
}
