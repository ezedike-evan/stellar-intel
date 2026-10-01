import { describe, it, expect } from 'vitest';
import { ANCHORS, ANCHOR_HOME_DOMAINS, CORRIDORS, VISIBLE_CORRIDORS } from '@/constants/anchors';
import { getAnchorsByCorridorId, isSep31Only, transferCapable } from '@/lib/stellar/anchors';
import { USDC_ISSUER } from '@/lib/config';

/**
 * perahub (#1303, ANC035) — a live SEP-31 receiving anchor paying PHP, tracked
 * in the record and probed for health, never routed.
 *
 * PeraHub's TOML advertises exactly one transfer server:
 * DIRECT_PAYMENT_SERVER = https://stellar.perahub.com.ph/sep31, plus SEP-10 and
 * SEP-12 (verified 2026-09-23). There is no SEP-6 and no SEP-24, so the anchor has
 * no deposit rail and cannot be quoted against.
 *
 * SEP-31 is also not routable in principle: receiving on SEP-31 requires a
 * bilateral agreement with a sending anchor, which we do not have with PeraHub.
 * That is a property of the protocol, not a temporary gap, which is why this lane
 * lives in `sep31Corridors` and never in `corridors`. These assertions exist so a
 * future "let's just route it" change has to delete them deliberately.
 */
describe('perahub — SEP-31-only USDC→PHP anchor (#1303)', () => {
  it('is registered with the facts the 2026-09-23 census verified', () => {
    const anchor = ANCHORS.find((a) => a.id === 'perahub');

    expect(anchor).toBeDefined();
    expect(anchor?.name).toBe('PeraHub');
    expect(anchor?.homeDomain).toBe('stellar.perahub.com.ph');
    expect(ANCHOR_HOME_DOMAINS['perahub']).toBe('stellar.perahub.com.ph');
    expect(anchor?.assetCode).toBe('USDC');
    // The TOML lists USDC under the canonical issuer, so this is not a look-alike.
    expect(anchor?.assetIssuer).toBe(USDC_ISSUER);
    expect(anchor?.seps).toEqual(['sep10', 'sep31']);
  });

  it('serves usdc-php as a SEP-31 corridor only, never as a routable one', () => {
    const anchor = ANCHORS.find((a) => a.id === 'perahub');

    expect(anchor?.corridors).toEqual([]);
    expect(anchor?.sep31Corridors).toEqual(['usdc-php']);
  });

  it('isSep31Only is true', () => {
    const anchor = ANCHORS.find((a) => a.id === 'perahub');

    expect(anchor).toBeDefined();
    expect(isSep31Only(anchor!)).toBe(true);
    // The corollary that keeps it out of every quote path.
    expect(transferCapable(anchor!)).toBe(false);
  });

  it('is not returned by getAnchorsByCorridorId("usdc-php")', () => {
    const ids = getAnchorsByCorridorId('usdc-php').map((a) => a.id);

    expect(ids).not.toContain('perahub');
    expect(ids).toEqual([]);
  });

  it('usdc-php is absent from VISIBLE_CORRIDORS', () => {
    expect(VISIBLE_CORRIDORS.map((c) => c.id)).not.toContain('usdc-php');
  });

  it('keeps the usdc-php corridor defined so lookups still resolve', () => {
    const corridor = CORRIDORS.find((c) => c.id === 'usdc-php');

    expect(corridor).toBeDefined();
    expect(corridor?.from).toBe('USDC');
    expect(corridor?.fromIssuer).toBe(USDC_ISSUER);
    expect(corridor?.fromPeg).toBe('USD');
    expect(corridor?.to).toBe('PHP');
    expect(corridor?.countryCode).toBe('PH');
    expect(corridor?.countryName).toBe('Philippines');
  });
});
