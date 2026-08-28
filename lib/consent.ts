/**
 * lib/consent.ts
 *
 * One-time acknowledgment of the Terms before a user's first execution (#741).
 *
 * Keyed by wallet address, not by browser: consent is given by the party who
 * signs, and a shared machine must not carry one wallet's acknowledgment over
 * to another.
 *
 * Deliberately gates execution only. Browsing rates requires no acknowledgment,
 * because nothing has been committed to — an interstitial in front of public
 * information is friction without a purpose.
 */

const STORAGE_PREFIX = 'offramp-terms-accepted';

/**
 * Version of the terms a stored acknowledgment refers to.
 *
 * Bumping this invalidates every stored consent, so a material change to the
 * terms re-prompts rather than silently relying on agreement to older wording.
 */
export const CONSENT_VERSION = '2026-08-04';

function storageKey(walletAddress: string): string {
  return `${STORAGE_PREFIX}:${walletAddress}`;
}

/** True when this wallet has accepted the current version of the terms. */
export function hasAcceptedTerms(walletAddress: string): boolean {
  if (!walletAddress) return false;

  try {
    return localStorage.getItem(storageKey(walletAddress)) === CONSENT_VERSION;
  } catch {
    // Private browsing or storage disabled. Treat as not accepted: prompting a
    // user twice is a nuisance, executing without acknowledgment is not.
    return false;
  }
}

/** Records acceptance of the current terms for this wallet. */
export function acceptTerms(walletAddress: string): void {
  if (!walletAddress) return;

  try {
    localStorage.setItem(storageKey(walletAddress), CONSENT_VERSION);
  } catch {
    // Best effort. The user is prompted again next session rather than the
    // execution being blocked.
  }
}

/** Test seam: clears a wallet's stored acknowledgment. */
export function clearAcceptance(walletAddress: string): void {
  try {
    localStorage.removeItem(storageKey(walletAddress));
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
