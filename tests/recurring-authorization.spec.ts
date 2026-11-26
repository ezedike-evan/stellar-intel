import { describe, it, expect } from 'vitest';
import {
  StandingAuthorizationTermsSchema,
  SignedStandingAuthorizationSchema,
  hashStandingAuthorization,
  type StandingAuthorizationTerms,
} from '@/lib/recurring';

const SENDER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const VALID_TERMS: StandingAuthorizationTerms = {
  type: 'recurring-authorization',
  version: 1,
  sender: SENDER,
  corridorId: 'usdc-ngn',
  sourceAsset: 'USDC',
  destinationAsset: 'NGN',
  amount: '100',
  perPeriodCap: '500',
  period: 'weekly',
  startAt: '2026-11-20T00:00:00.000Z',
  stopAt: '2026-12-20T00:00:00.000Z',
  anchorAllowlist: ['moneygram', 'cowrie'],
  nonce: '0123456789abcdef0123456789abcdef',
};

describe('recurring-authorization (REC001)', () => {
  it('parses a valid terms object', () => {
    const res = StandingAuthorizationTermsSchema.safeParse(VALID_TERMS);
    expect(res.success).toBe(true);
  });

  it('fails when stopAt is missing', () => {
    const { stopAt, ...rest } = VALID_TERMS;
    const res = StandingAuthorizationTermsSchema.safeParse(rest);
    expect(res.success).toBe(false);
  });

  it('fails when stopAt equals or is before startAt', () => {
    const same = { ...VALID_TERMS, stopAt: VALID_TERMS.startAt };
    expect(StandingAuthorizationTermsSchema.safeParse(same).success).toBe(false);

    const before = { ...VALID_TERMS, stopAt: '2026-11-19T00:00:00.000Z' };
    expect(StandingAuthorizationTermsSchema.safeParse(before).success).toBe(false);
  });

  it('fails when anchorAllowlist is empty or contains duplicates', () => {
    const empty = { ...VALID_TERMS, anchorAllowlist: [] };
    expect(StandingAuthorizationTermsSchema.safeParse(empty).success).toBe(false);

    const duplicate = { ...VALID_TERMS, anchorAllowlist: ['moneygram', 'moneygram'] };
    expect(StandingAuthorizationTermsSchema.safeParse(duplicate).success).toBe(false);
  });

  it('fails on an extra unknown key (strict)', () => {
    const extra = { ...VALID_TERMS, extraKey: 'unexpected' };
    expect(StandingAuthorizationTermsSchema.safeParse(extra).success).toBe(false);
  });

  it('fails on a non-hex or invalid length nonce', () => {
    const nonHex = { ...VALID_TERMS, nonce: 'not-hex-nonce-string-32-chars!!' };
    expect(StandingAuthorizationTermsSchema.safeParse(nonHex).success).toBe(false);

    const shortHex = { ...VALID_TERMS, nonce: '0123456789abcdef' };
    expect(StandingAuthorizationTermsSchema.safeParse(shortHex).success).toBe(false);
  });

  it('fails when corridorId does not match sourceAsset-destinationAsset', () => {
    const mismatch = { ...VALID_TERMS, destinationAsset: 'KES' };
    expect(StandingAuthorizationTermsSchema.safeParse(mismatch).success).toBe(false);
  });

  it('fails SignedStandingAuthorizationSchema when publicKey !== terms.sender', () => {
    const signed = {
      terms: VALID_TERMS,
      termsHash: 'a'.repeat(64),
      signature: 'dummy-sig',
      publicKey: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
    };
    expect(SignedStandingAuthorizationSchema.safeParse(signed).success).toBe(false);

    const validSigned = {
      ...signed,
      publicKey: SENDER,
    };
    expect(SignedStandingAuthorizationSchema.safeParse(validSigned).success).toBe(true);
  });

  it('hashStandingAuthorization is canonical, returns 64 lowercase hex chars, and reflects changes', async () => {
    const hash1 = await hashStandingAuthorization(VALID_TERMS);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);

    // Same terms with keys in different order
    const reordered: StandingAuthorizationTerms = {
      nonce: VALID_TERMS.nonce,
      anchorAllowlist: VALID_TERMS.anchorAllowlist,
      stopAt: VALID_TERMS.stopAt,
      startAt: VALID_TERMS.startAt,
      period: VALID_TERMS.period,
      perPeriodCap: VALID_TERMS.perPeriodCap,
      amount: VALID_TERMS.amount,
      destinationAsset: VALID_TERMS.destinationAsset,
      sourceAsset: VALID_TERMS.sourceAsset,
      corridorId: VALID_TERMS.corridorId,
      sender: VALID_TERMS.sender,
      version: VALID_TERMS.version,
      type: VALID_TERMS.type,
    };
    const hash2 = await hashStandingAuthorization(reordered);
    expect(hash2).toBe(hash1);

    // Different perPeriodCap
    const modified = { ...VALID_TERMS, perPeriodCap: '600' };
    const hash3 = await hashStandingAuthorization(modified);
    expect(hash3).not.toBe(hash1);
    expect(hash3).toMatch(/^[0-9a-f]{64}$/);
  });
});
