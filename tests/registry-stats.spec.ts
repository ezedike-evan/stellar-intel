import { describe, it, expect } from 'vitest';
import { ANCHORS, CORRIDORS, registryStats } from '@/constants/anchors';

// The landing stat bar (#B074) advertises these counts to visitors, so they
// must track the registry exactly — never a hard-coded or stale figure.
describe('registryStats', () => {
  it('counts every integrated anchor', () => {
    expect(registryStats().anchors).toBe(ANCHORS.length);
  });

  it('counts the distinct corridors anchors actually serve', () => {
    const expected = new Set(ANCHORS.flatMap((a) => a.corridors)).size;
    expect(registryStats().corridors).toBe(expected);
  });

  it('counts the distinct destination countries of served corridors', () => {
    const served = new Set(ANCHORS.flatMap((a) => a.corridors));
    const expected = new Set(CORRIDORS.filter((c) => served.has(c.id)).map((c) => c.countryCode))
      .size;
    expect(registryStats().countries).toBe(expected);
  });

  it('does not count corridors with no anchor behind them', () => {
    const served = new Set(ANCHORS.flatMap((a) => a.corridors));
    // The registry intentionally defines more corridors than anchors serve.
    expect(registryStats().corridors).toBeLessThanOrEqual(CORRIDORS.length);
    expect([...served].every((id) => CORRIDORS.some((c) => c.id === id))).toBe(true);
  });

  it('never counts more countries than corridors', () => {
    const { corridors, countries } = registryStats();
    expect(countries).toBeLessThanOrEqual(corridors);
  });
});
