import { describe, it, expect } from 'vitest';
import { listCorridors, CORRIDORS_TOOL_NAME } from './corridors.js';
import { CORRIDORS, VISIBLE_CORRIDORS } from '@/constants/anchors';
import { getAnchorsByCorridorId } from '@/lib/stellar/anchors';

describe('corridors tool', () => {
  it('is registered under the documented tool name', () => {
    expect(CORRIDORS_TOOL_NAME).toBe('intel.corridors');
  });

  it('lists exactly the visible corridors, in registry order', () => {
    expect(listCorridors().map((c) => c.id)).toEqual(VISIBLE_CORRIDORS.map((c) => c.id));
  });

  it('omits corridors the UI hides behind a flag', () => {
    const hidden = CORRIDORS.filter((c) => !VISIBLE_CORRIDORS.some((v) => v.id === c.id));
    const listed = new Set(listCorridors().map((c) => c.id));
    for (const corridor of hidden) {
      expect(listed.has(corridor.id)).toBe(false);
    }
  });

  it('carries the selector label plus the raw fields it is built from', () => {
    for (const corridor of listCorridors()) {
      const source = VISIBLE_CORRIDORS.find((c) => c.id === corridor.id);
      expect(source).toBeDefined();
      expect(corridor.displayName).toBe(`${source!.countryName} (${source!.to})`);
      expect(corridor.from).toBe(source!.from);
      expect(corridor.to).toBe(source!.to);
      expect(corridor.countryCode).toBe(source!.countryCode);
    }
  });

  it('reports the anchors serving each corridor', () => {
    for (const corridor of listCorridors()) {
      const expected = getAnchorsByCorridorId(corridor.id);
      expect(corridor.anchors.map((a) => a.id)).toEqual(expected.map((a) => a.id));
      for (const anchor of corridor.anchors) {
        expect(anchor.name.length).toBeGreaterThan(0);
        expect(anchor.homeDomain.length).toBeGreaterThan(0);
      }
    }
  });
});
