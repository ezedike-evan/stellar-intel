import { canonicalizeIntent } from './canonical'
import type { Intent } from '@/types'

/**
 * Compute the SHA-256 hash of a canonicalized intent.
 *
 * This hash is used as the unique identifier for the intent and is what
 * the user signs when creating a SignedIntent.
 *
 * @param intent - The intent to hash
 * @returns The hex-encoded SHA-256 hash
 */
export async function hashIntent(intent: Intent): Promise<string> {
  const canonical = canonicalizeIntent(intent)
  return hashCanonicalJson(canonical)
}

/**
 * Compute the SHA-256 hash of a canonical JSON string.
 * This is useful when you already have the canonical form.
 *
 * @param canonicalJson - The canonical JSON string
 * @returns The hex-encoded SHA-256 hash
 */
export async function hashCanonicalJson(canonicalJson: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(canonicalJson)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}
