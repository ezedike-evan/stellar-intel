import { claimSharedIntentNonce, pruneSharedIntentNonces } from '@/lib/api/shared-state';

// In-process fallback, used when no shared backend is configured or it errors.
// It is per-instance and therefore NOT replay protection across instances on
// serverless. See lib/api/shared-state.ts.
const nonceStore = new Map<string, Map<string, number>>();

/** Prune roughly once every this many shared claims, rather than on a timer. */
const PRUNE_EVERY = 500;
let claimsSincePrune = 0;

export type IntentReplayInput = {
  publicKey: string;
  nonce: string;
  deadline: string | number | Date;
};

export type IntentReplayResult =
  | { ok: true }
  | { ok: false; status: 409 | 410; code: 'replay_detected' | 'deadline_expired'; message: string };

function toDeadlineMs(deadline: string | number | Date): number {
  if (deadline instanceof Date) return deadline.getTime();
  if (typeof deadline === 'number') return deadline;
  return Date.parse(deadline);
}

function pruneExpiredNonces(publicKey: string, now: number): void {
  const existing = nonceStore.get(publicKey);
  if (!existing) return;

  for (const [nonce, expiresAt] of existing.entries()) {
    if (expiresAt <= now) {
      existing.delete(nonce);
    }
  }

  if (existing.size === 0) {
    nonceStore.delete(publicKey);
  }
}

export function clearIntentReplayStore(): void {
  nonceStore.clear();
  claimsSincePrune = 0;
}

/** True when claimed, false on a replay, null when shared state is unavailable. */
async function claimShared(
  input: IntentReplayInput,
  deadlineMs: number,
  now: number
): Promise<boolean | null> {
  try {
    const claimed = await claimSharedIntentNonce(input.publicKey, input.nonce, deadlineMs, now);
    if (claimed !== null) {
      claimsSincePrune += 1;
      if (claimsSincePrune >= PRUNE_EVERY) {
        claimsSincePrune = 0;
        // Fire and forget: pruning is housekeeping, and awaiting it would put a
        // DELETE on the request path.
        void pruneSharedIntentNonces(now).catch(() => {});
      }
    }
    return claimed;
  } catch {
    return null;
  }
}

export async function registerIntentReplay(
  input: IntentReplayInput,
  now = Date.now()
): Promise<IntentReplayResult> {
  const deadlineMs = toDeadlineMs(input.deadline);

  if (!Number.isFinite(deadlineMs)) {
    return {
      ok: false,
      status: 410,
      code: 'deadline_expired',
      message: 'Intent deadline is invalid or expired.',
    };
  }

  if (deadlineMs <= now) {
    return {
      ok: false,
      status: 410,
      code: 'deadline_expired',
      message: 'Intent deadline has expired.',
    };
  }

  const claimed = await claimShared(input, deadlineMs, now);

  pruneExpiredNonces(input.publicKey, now);

  const existing = nonceStore.get(input.publicKey) ?? new Map<string, number>();
  if (claimed === false || (claimed === null && existing.has(input.nonce))) {
    return {
      ok: false,
      status: 409,
      code: 'replay_detected',
      message: 'Nonce already used for this public key.',
    };
  }

  // Recorded on the shared path too, so a nonce claimed there is still
  // rejected by this instance if the database errors on a later replay.
  existing.set(input.nonce, deadlineMs);
  nonceStore.set(input.publicKey, existing);

  return { ok: true };
}
