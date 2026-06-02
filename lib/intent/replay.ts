const nonceStore = new Map<string, Map<string, number>>()

export type IntentReplayInput = {
  publicKey: string
  nonce: string
  deadline: string | number | Date
}

export type IntentReplayResult =
  | { ok: true }
  | { ok: false; status: 409 | 410; code: 'replay_detected' | 'deadline_expired'; message: string }

function toDeadlineMs(deadline: string | number | Date): number {
  if (deadline instanceof Date) return deadline.getTime()
  if (typeof deadline === 'number') return deadline
  return Date.parse(deadline)
}

function pruneExpiredNonces(publicKey: string, now: number): void {
  const existing = nonceStore.get(publicKey)
  if (!existing) return

  for (const [nonce, expiresAt] of existing.entries()) {
    if (expiresAt <= now) {
      existing.delete(nonce)
    }
  }

  if (existing.size === 0) {
    nonceStore.delete(publicKey)
  }
}

export function clearIntentReplayStore(): void {
  nonceStore.clear()
}

export function registerIntentReplay(
  input: IntentReplayInput,
  now = Date.now()
): IntentReplayResult {
  const deadlineMs = toDeadlineMs(input.deadline)

  if (!Number.isFinite(deadlineMs)) {
    return {
      ok: false,
      status: 410,
      code: 'deadline_expired',
      message: 'Intent deadline is invalid or expired.',
    }
  }

  if (deadlineMs <= now) {
    return {
      ok: false,
      status: 410,
      code: 'deadline_expired',
      message: 'Intent deadline has expired.',
    }
  }

  pruneExpiredNonces(input.publicKey, now)

  const existing = nonceStore.get(input.publicKey) ?? new Map<string, number>()
  if (existing.has(input.nonce)) {
    return {
      ok: false,
      status: 409,
      code: 'replay_detected',
      message: 'Nonce already used for this public key.',
    }
  }

  existing.set(input.nonce, deadlineMs)
  nonceStore.set(input.publicKey, existing)

  return { ok: true }
}