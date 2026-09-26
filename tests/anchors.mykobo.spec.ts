import { describe, it, expect } from 'vitest';
import {
  ANCHORS,
  CORRIDORS,
  VISIBLE_CORRIDORS,
  V11_CORRIDOR_IDS,
  ANCHOR_HOME_DOMAINS,
} from '@/constants/anchors';

/**
 * mykobo.co triage (B028) — delisted 2026-09-06.
 *
 * MyKobo's own stellar.toml advertises both TRANSFER_SERVER and
 * TRANSFER_SERVER_SEP0024 on stellar.mykobo.co, and that host has no A or AAAA
 * record, so every SEP-6 and SEP-24 call to it fails to connect. The TOML still
 * returns 200, which is why a check that stops at the TOML read this anchor as
 * healthy for as long as it did.
 *
 * These assertions are the inverse of the ones this file used to make. They
 * exist so a re-list is a deliberate act with a passing endpoint behind it,
 * rather than something that happens by accident.
 */
describe('mykobo.co triage (B028) — delisted', () => {
  it('is not in the registry', () => {
    expect(ANCHORS.find((a) => a.id === 'mykobo')).toBeUndefined();
  });

  it('has no home-domain entry', () => {
    expect(ANCHOR_HOME_DOMAINS['mykobo']).toBeUndefined();
  });

  it('leaves no anchor serving usdc-eur', () => {
    expect(ANCHORS.filter((a) => a.corridors.includes('usdc-eur'))).toEqual([]);
  });

  it('keeps the usdc-eur corridor defined so lookups still resolve', () => {
    const corridor = CORRIDORS.find((c) => c.id === 'usdc-eur');
    expect(corridor).toBeDefined();
    expect(corridor?.from).toBe('USDC');
    expect(corridor?.to).toBe('EUR');
  });

  it('hides usdc-eur from selectors while it has no anchor', () => {
    expect(V11_CORRIDOR_IDS.has('usdc-eur')).toBe(true);
    expect(VISIBLE_CORRIDORS.map((c) => c.id)).not.toContain('usdc-eur');
  });
});
