import { describe, it, expect } from 'vitest';
import { ANCHORS, CORRIDORS, VISIBLE_CORRIDORS, ANCHOR_HOME_DOMAINS } from '@/constants/anchors';

/**
 * bitnovo.com (ANC032) — delisted 2026-10-25.
 *
 * stellar.bitnovo.com answers every request, the TOML included, with HTTP 502
 * from its proxy, and had on each nightly probe for 13 nights. SEP-24 cannot be
 * reached, so the anchor cannot serve the corridor it was registered for.
 *
 * These assertions are the inverse of the ones this file used to make. They
 * exist so a re-list is a deliberate act with a passing endpoint behind it,
 * rather than something that happens by accident. See docs/anchors/delisted.md.
 */
describe('bitnovo.com (ANC032) — delisted', () => {
  it('is not in the registry', () => {
    expect(ANCHORS.find((a) => a.id === 'bitnovo')).toBeUndefined();
  });

  it('has no home-domain entry', () => {
    expect(ANCHOR_HOME_DOMAINS['bitnovo']).toBeUndefined();
  });

  it('leaves usdc-eur served by APS Ramp alone', () => {
    expect(ANCHORS.filter((a) => a.corridors.includes('usdc-eur')).map((a) => a.id)).toEqual([
      'aps',
    ]);
    expect(VISIBLE_CORRIDORS.map((c) => c.id)).toContain('usdc-eur');
  });

  it('keeps the usdc-eur corridor defined so lookups still resolve', () => {
    const corridor = CORRIDORS.find((c) => c.id === 'usdc-eur');
    expect(corridor?.from).toBe('USDC');
    expect(corridor?.to).toBe('EUR');
  });
});
