import { describe, it, expect } from 'vitest';
import { ANCHORS, CORRIDORS, ANCHOR_HOME_DOMAINS } from '@/constants/anchors';
import { USDC_ISSUER } from '@/lib/config';

// ANC031 — APS Ramp (ramp.aps.money) onboarded from the anchor census outside
// the `anchor` tag. Its SEP-24 /info advertises USDC deposit/withdraw but not the
// payout currencies, so every corridor it serves is registered unverified until
// an interactive session confirms the payout currency per corridor.
describe('APS Ramp anchor', () => {
  const aps = ANCHORS.find((a) => a.id === 'aps');

  it('is present in ANCHORS list', () => {
    expect(aps).toBeDefined();
  });

  it('uses the live ramp.aps.money home domain', () => {
    expect(aps?.homeDomain).toBe('ramp.aps.money');
    expect(ANCHOR_HOME_DOMAINS['aps']).toBe('ramp.aps.money');
  });

  it('anchors USDC with the canonical issuer and SEP-10 / SEP-24', () => {
    expect(aps?.assetCode).toBe('USDC');
    expect(aps?.assetIssuer).toBe(USDC_ISSUER);
    expect(aps?.seps).toEqual(['sep10', 'sep24']);
  });

  it('serves all three census corridors', () => {
    expect(aps?.corridors).toEqual(['usdc-brl', 'usdc-eur', 'usdc-clp']);
  });

  it('flags all three corridors as unverified (payout currency unconfirmed)', () => {
    expect(aps?.unverifiedCorridors).toEqual(['usdc-brl', 'usdc-eur', 'usdc-clp']);
    for (const corridorId of aps?.corridors ?? []) {
      expect(aps?.unverifiedCorridors).toContain(corridorId);
    }
  });

  it('usdc-clp corridor is defined in CORRIDORS', () => {
    const corridor = CORRIDORS.find((c) => c.id === 'usdc-clp');
    expect(corridor).toBeDefined();
    expect(corridor?.from).toBe('USDC');
    expect(corridor?.fromIssuer).toBe(USDC_ISSUER);
    expect(corridor?.fromPeg).toBe('USD');
    expect(corridor?.to).toBe('CLP');
    expect(corridor?.countryCode).toBe('CL');
    expect(corridor?.countryName).toBe('Chile');
  });
});
