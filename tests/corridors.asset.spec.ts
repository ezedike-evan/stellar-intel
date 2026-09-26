import { describe, expect, it } from 'vitest';
import { CORRIDORS } from '@/constants/anchors';
import { USDC_ISSUER } from '@/lib/config';

const STELLAR_PUBKEY_PATTERN = /^G[A-Z2-7]{55}$/;
const ISO_4217_PATTERN = /^[A-Z]{3}$/;

describe('corridor on-chain asset metadata', () => {
  it('gives every corridor a valid issuer, or null for native XLM', () => {
    for (const corridor of CORRIDORS) {
      const valid =
        corridor.fromIssuer === null || STELLAR_PUBKEY_PATTERN.test(corridor.fromIssuer);
      expect(valid, `${corridor.id} has an invalid fromIssuer: ${corridor.fromIssuer}`).toBe(true);
    }
  });

  it('gives every corridor an ISO 4217 peg currency', () => {
    for (const corridor of CORRIDORS) {
      expect(
        ISO_4217_PATTERN.test(corridor.fromPeg),
        `${corridor.id} has an invalid fromPeg: ${corridor.fromPeg}`
      ).toBe(true);
    }
  });

  it('pins every usdc-* corridor to the configured USDC issuer pegged to USD', () => {
    const usdcCorridors = CORRIDORS.filter((corridor) => corridor.id.startsWith('usdc-'));

    expect(usdcCorridors.length).toBeGreaterThan(0);
    for (const corridor of usdcCorridors) {
      expect(corridor.fromIssuer).toBe(USDC_ISSUER);
      expect(corridor.fromPeg).toBe('USD');
    }
  });

  it('keeps corridor ids unique', () => {
    const ids = CORRIDORS.map((corridor) => corridor.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
