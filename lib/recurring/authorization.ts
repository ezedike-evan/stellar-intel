import { hashIntent, type HashableIntent } from '@/lib/intent/hash';
import { verifyIntentSignature } from '@/lib/intent/verify';
import { registeredAnchorsForCorridor } from '@/lib/intent/anchor-accounts';
import { isValidCorridorId } from '@/lib/stellar/anchors';
import {
  SignedStandingAuthorizationSchema,
  type SignedStandingAuthorization,
  type StandingAuthorizationTerms,
} from '@/types/recurring';
import { compareDecimals } from './scheduler';

export const STANDING_AUTHORIZATION_MAX_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

export async function hashStandingAuthorization(
  terms: StandingAuthorizationTerms
): Promise<string> {
  return hashIntent(terms as unknown as HashableIntent);
}

// ─── Server-side verification (REC002) ───────────────────────────────────────

export type StandingAuthorizationErrorCode =
  | 'invalid_payload'
  | 'hash_mismatch'
  | 'invalid_signature'
  | 'unknown_corridor'
  | 'anchor_not_in_corridor'
  | 'amount_exceeds_cap'
  | 'stop_in_past'
  | 'start_too_old'
  | 'window_too_long';

export type StandingAuthorizationVerification =
  | { ok: true; authorization: SignedStandingAuthorization }
  | { ok: false; code: StandingAuthorizationErrorCode; message: string };

function fail(
  code: StandingAuthorizationErrorCode,
  message: string
): StandingAuthorizationVerification {
  return { ok: false, code, message };
}

/**
 * Prove that the sender signed exactly these terms and that the terms are within
 * policy, before a standing order is stored. The checks run in a fixed order and
 * the first failure wins. Never throws: any unexpected error is `invalid_payload`.
 */
export async function verifyStandingAuthorization(
  input: unknown,
  opts: { now?: Date } = {}
): Promise<StandingAuthorizationVerification> {
  try {
    const parsed = SignedStandingAuthorizationSchema.safeParse(input);
    if (!parsed.success) {
      return fail(
        'invalid_payload',
        parsed.error.issues[0]?.message ?? 'Invalid standing authorization'
      );
    }
    const authorization = parsed.data;
    const { terms, termsHash, publicKey, signature } = authorization;

    if ((await hashStandingAuthorization(terms)) !== termsHash) {
      return fail('hash_mismatch', 'termsHash does not match the hash of terms');
    }

    if (!verifyIntentSignature({ intentHash: termsHash, publicKey, signature })) {
      return fail('invalid_signature', 'signature does not verify against publicKey');
    }

    if (!isValidCorridorId(terms.corridorId)) {
      return fail('unknown_corridor', `Unknown corridor: ${terms.corridorId}`);
    }

    const served = new Set(registeredAnchorsForCorridor(terms.corridorId));
    const outside = terms.anchorAllowlist.find((id) => !served.has(id));
    if (outside !== undefined) {
      return fail(
        'anchor_not_in_corridor',
        `Anchor ${outside} does not serve corridor ${terms.corridorId}`
      );
    }

    if (compareDecimals(terms.amount, terms.perPeriodCap) > 0) {
      return fail('amount_exceeds_cap', 'amount exceeds perPeriodCap');
    }

    const now = (opts.now ?? new Date()).getTime();
    const startAt = Date.parse(terms.startAt);
    const stopAt = Date.parse(terms.stopAt);

    if (stopAt <= now) {
      return fail('stop_in_past', 'stopAt is not in the future');
    }

    if (startAt < now - DAY_MS) {
      return fail('start_too_old', 'startAt is more than 24 hours in the past');
    }

    if (stopAt - startAt > STANDING_AUTHORIZATION_MAX_DAYS * DAY_MS) {
      return fail(
        'window_too_long',
        `stopAt must be within ${STANDING_AUTHORIZATION_MAX_DAYS} days of startAt`
      );
    }

    return { ok: true, authorization };
  } catch {
    return fail('invalid_payload', 'Invalid standing authorization');
  }
}
