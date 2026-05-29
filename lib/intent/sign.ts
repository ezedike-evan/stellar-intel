import { hashIntent } from './hash'
import type { Intent, SignedIntent } from '@/types'

/**
 * Sign an intent using the user's wallet via Freighter.
 *
 * This function:
 * 1. Canonicalizes the intent
 * 2. Computes the SHA-256 hash
 * 3. Asks the user to sign the hash via Freighter
 * 4. Returns the SignedIntent
 *
 * @param intent - The intent to sign
 * @returns The signed intent with signature
 */
export async function signIntent(intent: Intent): Promise<SignedIntent> {
  const intentHash = await hashIntent(intent)
  
  // Convert hex hash to Uint8Array for signing
  const hashBytes = new Uint8Array(
    intentHash.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
  )

  // Use Freighter to sign the hash
  const { signMessage } = await import('@stellar/freighter-api')
  const result = await signMessage(hashBytes)

  if (result.error) {
    throw new Error(`Failed to sign intent: ${result.error.message}`)
  }

  const signature = result.signedMessage

  return {
    intent,
    intentHash,
    signature,
  }
}

/**
 * Verify a SignedIntent's signature.
 * 
 * This is useful for server-side verification when receiving a signed intent.
 * Note: This requires the public key to be known (from the intent.account field).
 *
 * @param signedIntent - The signed intent to verify
 * @returns true if the signature is valid, false otherwise
 */
export async function verifySignedIntent(signedIntent: SignedIntent): Promise<boolean> {
  const { intent, intentHash, signature } = signedIntent

  // Recompute the hash to ensure it matches
  const recomputedHash = await hashIntent(intent)
  if (recomputedHash !== intentHash) {
    return false
  }

  // Verify the signature using Stellar SDK
  const { verify } = await import('@stellar/stellar-sdk')
  
  try {
    const isValid = await verify(
      signature,
      intentHash,
      intent.account
    )
    return isValid
  } catch {
    return false
  }
}
