import { describe, it, expect } from 'vitest';
import { ANCHORS, ANCHOR_HOME_DOMAINS, CORRIDORS, VISIBLE_CORRIDORS } from '@/constants/anchors';
import { getAnchorsByCorridorId, isSep31Only, transferCapable } from '@/lib/stellar/anchors';

/**
 * KB Trading / CLPX (#1304, ANC036) — a transfer-capable anchor whose CLPX→CLP
 * lane is SEP-31-only. Verified 2026-09-29 against its own endpoints.
 *
 * This is the awkward case, and it is why these assertions exist. The anchor
 * genuinely runs SEP-6 and SEP-24 and genuinely accepts CLPX deposits, so
 * `transferCapable()` is true and `isSep31Only()` is false — mechanically it
 * looks like an ordinary routable anchor. But its withdraw map is
 * `CLPX: { enabled: false }, BTCLN: enabled (lightning)`, so no programmatic
 * rail moves CLPX back out to fiat. The only CLPX→CLP path is SEP-31 receive,
 * and SEP-31 is never routed because it needs a bilateral sending-anchor
 * agreement.
 *
 * So the exclusion has to come from the registry data (`corridors: []`, the
 * lane in `sep31Corridors`) rather than from a filter — and the test below pins
 * that data, so nobody has to remember it. If a future KB Trading release turns
 * CLPX withdraw on, this file is the place that should change first.
 */
describe('KB Trading (CLPX) — CLPX→CLP lane is SEP-31-only (#1304)', () => {
  const anchor = ANCHORS.find((a) => a.id === 'clpx');

  it('is registered with the facts the 2026-09-29 verification found', () => {
    expect(anchor).toBeDefined();
    expect(anchor?.name).toBe('KB Trading (CLPX)');
    expect(anchor?.homeDomain).toBe('kbtrading.org');
    expect(ANCHOR_HOME_DOMAINS['clpx']).toBe('kbtrading.org');
    expect(anchor?.assetCode).toBe('CLPX');
    expect(anchor?.assetIssuer).toBe('GDYSPBVZHPQTYMGSYNOHRZQNLB3ZWFVQ2F7EP7YBOLRGD42XIC3QUX5G');
    expect(anchor?.seps).toEqual(['sep6', 'sep10', 'sep24', 'sep31']);
  });

  it('serves clpx-clp as a SEP-31 corridor only', () => {
    expect(anchor?.corridors).toEqual([]);
    expect(anchor?.sep31Corridors).toEqual(['clpx-clp']);
  });

  it('is not returned by getAnchorsByCorridorId("clpx-clp")', () => {
    const ids = getAnchorsByCorridorId('clpx-clp').map((a) => a.id);

    expect(ids).not.toContain('clpx');
    expect(ids).toEqual([]);
  });

  it('clpx-clp is absent from VISIBLE_CORRIDORS', () => {
    expect(VISIBLE_CORRIDORS.map((c) => c.id)).not.toContain('clpx-clp');
  });

  it('is transfer-capable in general, which is why the exclusion is data-driven', () => {
    // The contrast with perahub: SEP-6/SEP-24 are really advertised here, so
    // neither of these helpers can be what keeps the lane unroutable. The empty
    // `corridors` array above is.
    expect(anchor).toBeDefined();
    expect(transferCapable(anchor!)).toBe(true);
    expect(isSep31Only(anchor!)).toBe(false);
  });

  it('keeps the clpx-clp corridor defined so lookups still resolve', () => {
    const corridor = CORRIDORS.find((c) => c.id === 'clpx-clp');

    expect(corridor).toBeDefined();
    expect(corridor?.from).toBe('CLPX');
    expect(corridor?.fromIssuer).toBe('GDYSPBVZHPQTYMGSYNOHRZQNLB3ZWFVQ2F7EP7YBOLRGD42XIC3QUX5G');
    expect(corridor?.fromPeg).toBe('CLP');
    expect(corridor?.to).toBe('CLP');
    expect(corridor?.countryCode).toBe('CL');
    expect(corridor?.countryName).toBe('Chile');
  });
});
