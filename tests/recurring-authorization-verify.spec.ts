import { describe, it, expect } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import {
  hashStandingAuthorization,
  verifyStandingAuthorization,
} from '@/lib/recurring/authorization';
import type { StandingAuthorizationTerms, SignedStandingAuthorization } from '@/types/recurring';

describe('verifyStandingAuthorization', () => {
  const kp = Keypair.random();
  const validTerms: StandingAuthorizationTerms = {
    type: 'recurring-authorization',
    version: 1,
    sender: kp.publicKey(),
    corridorId: 'usdc-ngn',
    sourceAsset: 'USDC',
    destinationAsset: 'NGN',
    amount: '50',
    perPeriodCap: '200',
    period: 'daily',
    startDate: '2026-01-01T00:00:00.000Z',
    anchorAllowlist: ['cowrie'],
    nonce: 'nonce-1',
  };

  async function createValidSigned(): Promise<SignedStandingAuthorization> {
    const termsHash = await hashStandingAuthorization(validTerms);
    const sigBytes = kp.sign(new TextEncoder().encode(termsHash));
    const signature = Buffer.from(sigBytes).toString('base64');
    return {
      terms: validTerms,
      termsHash,
      signature,
      publicKey: kp.publicKey(),
    };
  }

  it('verifies a valid signed envelope', async () => {
    const signed = await createValidSigned();
    const res = await verifyStandingAuthorization(signed);
    expect(res.ok).toBe(true);
  });

  it('rejects invalid terms schema', async () => {
    const signed = await createValidSigned();
    const badSigned = {
      ...signed,
      terms: { ...signed.terms, amount: '-10' },
    } as unknown as SignedStandingAuthorization;

    const res = await verifyStandingAuthorization(badSigned);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('INVALID_TERMS');
    }
  });

  it('rejects hash mismatch', async () => {
    const signed = await createValidSigned();
    const badSigned: SignedStandingAuthorization = {
      ...signed,
      termsHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    };

    const res = await verifyStandingAuthorization(badSigned);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('HASH_MISMATCH');
    }
  });

  it('rejects signer mismatch', async () => {
    const otherKp = Keypair.random();
    const signed = await createValidSigned();
    const badSigned: SignedStandingAuthorization = {
      ...signed,
      publicKey: otherKp.publicKey(),
    };

    const res = await verifyStandingAuthorization(badSigned);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('SIGNER_MISMATCH');
    }
  });

  it('rejects signature mismatch', async () => {
    const otherKp = Keypair.random();
    const termsHash = await hashStandingAuthorization(validTerms);
    const badSig = Buffer.from(otherKp.sign(new TextEncoder().encode(termsHash))).toString('base64');
    const badSigned: SignedStandingAuthorization = {
      terms: validTerms,
      termsHash,
      signature: badSig,
      publicKey: kp.publicKey(),
    };

    const res = await verifyStandingAuthorization(badSigned);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('INVALID_SIGNATURE');
    }
  });
});
