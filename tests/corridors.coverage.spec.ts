import { describe, expect, it } from 'vitest';
import { ANCHORS, CORRIDORS } from '@/constants/anchors';
import type { Anchor, Corridor } from '@/types';

// usdc-eur was flagged off until mykobo.co (#639) started serving it.
const FLAGGED_OFF_CORRIDORS = {} as const satisfies Record<string, string>;

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

  it('catches an orphan corridor that is not flagged off', () => {
    const orphanCorridor: Corridor = {
      id: 'test-orphan',
      from: 'USDC',
      to: 'ZZZ',
      countryCode: 'ZZ',
      countryName: 'Testland',
    };

    expect(orphanVisibleCorridorIds([orphanCorridor], ANCHORS, flaggedOffCorridorIds)).toEqual([
      'test-orphan',
    ]);
  });
});
