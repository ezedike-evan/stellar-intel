import { Keypair } from '@stellar/stellar-sdk';
import { canonicalJson } from '@/lib/intent/hash';
import {
  type StandingAuthorizationTerms,
  type SignedStandingAuthorization,
  StandingAuthorizationTermsSchema,
} from '@/types/recurring';

export async function hashStandingAuthorization(
  terms: StandingAuthorizationTerms
): Promise<string> {
  const canonical = canonicalJson(terms);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export type StandingAuthorizationVerification =
  | { ok: true; authorization: SignedStandingAuthorization }
  | {
      ok: false;
      code:
        | 'INVALID_TERMS'
        | 'HASH_MISMATCH'
        | 'SIGNER_MISMATCH'
        | 'INVALID_SIGNATURE';
      message: string;
    };

export async function verifyStandingAuthorization(
  signed: SignedStandingAuthorization
): Promise<StandingAuthorizationVerification> {
  const parseRes = StandingAuthorizationTermsSchema.safeParse(signed?.terms);
  if (!parseRes.success) {
    return {
      ok: false,
      code: 'INVALID_TERMS',
      message: parseRes.error.issues.map((i) => i.message).join('; '),
    };
  }

  const computedHash = await hashStandingAuthorization(parseRes.data);
  if (computedHash !== signed.termsHash) {
    return {
      ok: false,
      code: 'HASH_MISMATCH',
      message: `Computed hash ${computedHash} does not match provided termsHash ${signed.termsHash}`,
    };
  }

  if (signed.publicKey !== parseRes.data.sender) {
    return {
      ok: false,
      code: 'SIGNER_MISMATCH',
      message: `Envelope publicKey ${signed.publicKey} does not match terms sender ${parseRes.data.sender}`,
    };
  }

  try {
    const kp = Keypair.fromPublicKey(signed.publicKey);
    const dataBytes = new TextEncoder().encode(signed.termsHash);
    const sigBytes = Buffer.from(signed.signature, 'base64');
    const valid = kp.verify(dataBytes, sigBytes);
    if (!valid) {
      return {
        ok: false,
        code: 'INVALID_SIGNATURE',
        message: 'Signature verification failed against termsHash',
      };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Invalid signature format';
    return {
      ok: false,
      code: 'INVALID_SIGNATURE',
      message: msg,
    };
  }

  return {
    ok: true,
    authorization: signed,
  };
}
