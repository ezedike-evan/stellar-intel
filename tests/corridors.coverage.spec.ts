import { describe, expect, it } from 'vitest';
import { ANCHORS, CORRIDORS, VISIBLE_CORRIDORS } from '@/constants/anchors';
import type { Anchor, Corridor } from '@/types';

// usdc-zar was flagged off until zeam.money (#465) started serving it.
const FLAGGED_OFF_CORRIDORS = {
  'usdc-xof': 'v1.1 target corridor, gated behind v11Corridors until an anchor serves it.',
  'usdc-ars': 'Orphaned when anclap was corrected to its own tokens 2026-09-23.',
  'usdc-pen': 'Orphaned when anclap was corrected to its own tokens 2026-09-23.',
  // perahub (#1303) serves usdc-php over SEP-31 only, and SEP-31 is never routed:
  // it needs a bilateral sending-anchor agreement. The corridor stays defined so the
  // lane is in the record, but it must not be treated as covered by registry `corridors`.
  'usdc-php': 'SEP-31-only (perahub); tracked, not routable',
  // kbtrading (#1304) serves clpx-clp over SEP-31 only: its SEP-6/SEP-24 rails
  // take CLPX in but pay BTCLN (Lightning) out, and withdraw.CLPX is advertised
  // disabled. The corridor stays defined so the lane is in the record, but it
  // must not count as covered by registry `corridors`.
  'clpx-clp': 'SEP-31-only (clpx); tracked, not routable',
} as const satisfies Record<string, string>;

function anchorIdsByCorridor(anchors: readonly Anchor[]): Map<string, string[]> {
  const coverage = new Map<string, string[]>();

  for (const anchor of anchors) {
    for (const corridorId of anchor.corridors) {
      const ids = coverage.get(corridorId) ?? [];
      ids.push(anchor.id);
      coverage.set(corridorId, ids);
    }
  }

  return coverage;
}

function orphanVisibleCorridorIds(
  corridors: readonly Pick<Corridor, 'id'>[],
  anchors: readonly Anchor[],
  flaggedOffCorridorIds: ReadonlySet<string>
): string[] {
  const coverage = anchorIdsByCorridor(anchors);

  return corridors
    .filter((corridor) => !flaggedOffCorridorIds.has(corridor.id))
    .filter((corridor) => (coverage.get(corridor.id) ?? []).length === 0)
    .map((corridor) => corridor.id);
}

describe('per-corridor anchor coverage', () => {
  const flaggedOffCorridorIds = new Set<string>(Object.keys(FLAGGED_OFF_CORRIDORS));
  const coverage = anchorIdsByCorridor(ANCHORS);

  it('does not flag off unknown corridors', () => {
    const corridorIds = new Set(CORRIDORS.map((corridor) => corridor.id));

    expect([...flaggedOffCorridorIds].filter((id) => !corridorIds.has(id))).toEqual([]);
  });

  it('keeps flagged-off corridors orphaned until they are ready to be visible', () => {
    const stillOrphaned = [...flaggedOffCorridorIds].filter(
      (id) => (coverage.get(id) ?? []).length === 0
    );

    expect(stillOrphaned).toEqual([...flaggedOffCorridorIds]);
  });

  it('requires every visible corridor to have at least one registered anchor', () => {
    expect(orphanVisibleCorridorIds(CORRIDORS, ANCHORS, flaggedOffCorridorIds)).toEqual([]);
  });

  it('keeps every visible corridor anchored by registry data', () => {
    const visibleIds = new Set(VISIBLE_CORRIDORS.map((corridor) => corridor.id));
    const coveredIds = new Set(ANCHORS.flatMap((anchor) => anchor.corridors));

    for (const corridorId of visibleIds) {
      expect(
        coveredIds.has(corridorId),
        `visible corridor ${corridorId} is missing anchor coverage`
      ).toBe(true);
    }
  });

  it('catches an orphan corridor that is not flagged off', () => {
    const orphanCorridor: Corridor = {
      id: 'test-orphan',
      from: 'USDC',
      fromIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      fromPeg: 'USD',
      to: 'ZZZ',
      countryCode: 'ZZ',
      countryName: 'Testland',
    };

    expect(orphanVisibleCorridorIds([orphanCorridor], ANCHORS, flaggedOffCorridorIds)).toEqual([
      'test-orphan',
    ]);
  });
});
