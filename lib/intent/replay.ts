/**
 * Replay protection for intents.
 * 
 * Prevents the same intent (identified by publicKey + nonce) from being
 * submitted multiple times within a time window.
 */

// In-memory store of used nonces (in production, this should be Redis or a database)
const usedNonces = new Map<string, { expiresAt: number }>()

// Cleanup interval to remove expired entries (run every minute)
const CLEANUP_INTERVAL_MS = 60_000

setInterval(() => {
  const now = Date.now()
  for (const [key, value] of usedNonces.entries()) {
    if (value.expiresAt < now) {
      usedNonces.delete(key)
    }
  }
}, CLEANUP_INTERVAL_MS)

/**
 * Register an intent for replay protection.
 * 
 * @param params - The intent parameters to register
 * @returns Result indicating success or failure
 */
export function registerIntentReplay(params: {
  publicKey: string
  nonce: string
  deadline: string
}): { ok: true } | { ok: false; status: number; code: string; message: string } {
  const { publicKey, nonce, deadline } = params

  // Validate inputs
  if (!publicKey || !nonce || !deadline) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'Missing required fields: publicKey, nonce, deadline',
    }
  }

  // Parse deadline
  const deadlineTime = new Date(deadline).getTime()
  if (isNaN(deadlineTime)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_DEADLINE',
      message: 'Invalid deadline format',
    }
  }

  // Check if deadline has passed
  const now = Date.now()
  if (deadlineTime < now) {
    return {
      ok: false,
      status: 400,
      code: 'EXPIRED_INTENT',
      message: 'Intent deadline has passed',
    }
  }

  // Create replay protection key
  const key = `${publicKey}:${nonce}`

  // Check if nonce has already been used
  const existing = usedNonces.get(key)
  if (existing && existing.expiresAt > now) {
    return {
      ok: false,
      status: 409,
      code: 'REPLAY_DETECTED',
      message: 'Intent with this nonce has already been submitted',
    }
  }

  // Register the nonce
  // Use the deadline as the expiry time, but cap it at 1 hour from now
  const maxExpiry = now + 60 * 60 * 1000 // 1 hour
  const expiryTime = Math.min(deadlineTime, maxExpiry)

  usedNonces.set(key, { expiresAt: expiryTime })

  return { ok: true }
}

/**
 * Clear all replay protection entries.
 * Useful for testing or manual cleanup.
 */
export function clearReplayProtection(): void {
  usedNonces.clear()
}

/**
 * Get the current number of active replay protection entries.
 * Useful for monitoring.
 */
export function getReplayProtectionSize(): number {
  return usedNonces.size
}
