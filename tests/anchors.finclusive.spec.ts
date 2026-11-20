import { describe, it, expect } from 'vitest';
import {
  ANCHORS,
  CORRIDORS,
  VISIBLE_CORRIDORS,
  V11_CORRIDOR_IDS,
  ANCHOR_HOME_DOMAINS,
} from '@/constants/anchors';

/**
 * finclusive.com (ANC034) — delisted 2026-10-25.
 *
 * The TLS certificate on api.finclusive.com, which hosts the SEP-6/SEP-24
 * transfer server and SEP-10 auth, expired 2026-10-04, so every client that
 * verifies certificates fails before reaching /info. The home-domain TOML still
 * serves 200, which is why a check that stops at the TOML read this anchor as
 * healthy.
 *
 * These assertions are the inverse of the ones this file used to make. They
 * exist so a re-list is a deliberate act with a passing endpoint behind it,
 * rather than something that happens by accident. See docs/anchors/delisted.md.
 */
describe('finclusive.com (ANC034) — delisted', () => {
  it('is not in the registry', () => {
    expect(ANCHORS.find((a) => a.id === 'finclusive')).toBeUndefined();
  });

  it('has no home-domain entry', () => {
    expect(ANCHOR_HOME_DOMAINS['finclusive']).toBeUndefined();
  });

  it('leaves usdc-usd with no anchor', () => {
    expect(ANCHORS.filter((a) => a.corridors.includes('usdc-usd'))).toEqual([]);
  });

  it('keeps the usdc-usd corridor defined so lookups still resolve', () => {
    const corridor = CORRIDORS.find((c) => c.id === 'usdc-usd');
    expect(corridor?.from).toBe('USDC');
    expect(corridor?.to).toBe('USD');
    expect(corridor?.countryCode).toBe('US');
  });

  it('hides the orphaned usdc-usd corridor from selectors', () => {
    expect(V11_CORRIDOR_IDS.has('usdc-usd')).toBe(true);
    expect(VISIBLE_CORRIDORS.map((c) => c.id)).not.toContain('usdc-usd');
  });
});
