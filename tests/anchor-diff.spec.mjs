import { describe, it, expect } from 'vitest';
import { diffDomainList, diffSnapshots, hasChanges, formatDiff } from '../scripts/anchor-diff.mjs';

describe('anchor-diff: diffDomainList', () => {
  it('finds domains added and removed between two lists', () => {
    const { added, removed } = diffDomainList(['a.com', 'b.com'], ['b.com', 'c.com']);
    expect(added).toEqual(['c.com']);
    expect(removed).toEqual(['a.com']);
  });

  it('is a no-op for identical lists', () => {
    const { added, removed } = diffDomainList(['a.com'], ['a.com']);
    expect(added).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('treats missing lists as empty', () => {
    expect(diffDomainList(undefined, ['a.com'])).toEqual({ added: ['a.com'], removed: [] });
    expect(diffDomainList(['a.com'], undefined)).toEqual({ added: [], removed: ['a.com'] });
  });
});

describe('anchor-diff: diffSnapshots / hasChanges', () => {
  const before = {
    transferCapableDomains: ['anclap.com', 'zeam.money'],
    issuerOnlyDomains: ['afreum.com'],
    unreachableDomains: ['dead.example'],
  };

  it('reports no changes for an identical snapshot', () => {
    const diff = diffSnapshots(before, before);
    expect(hasChanges(diff)).toBe(false);
    expect(formatDiff(diff)).toBe('No fleet changes since the last committed snapshot.');
  });

  it('detects a newly transfer-capable domain and a lost one', () => {
    const after = {
      transferCapableDomains: ['anclap.com', 'newanchor.example'],
      issuerOnlyDomains: ['afreum.com'],
      unreachableDomains: ['dead.example'],
    };
    const diff = diffSnapshots(before, after);
    expect(hasChanges(diff)).toBe(true);
    expect(diff.transferCapable.added).toEqual(['newanchor.example']);
    expect(diff.transferCapable.removed).toEqual(['zeam.money']);

    const rendered = formatDiff(diff);
    expect(rendered).toContain('Transfer-capable (SEP-6 / SEP-24)');
    expect(rendered).toContain('`newanchor.example`');
    expect(rendered).toContain('`zeam.money`');
    expect(rendered).not.toContain('Issuer-only');
  });
});

describe('anchor-diff: survey tiers (#1320)', () => {
  const withTiers = (tiers) => ({
    transferCapableDomains: [],
    issuerOnlyDomains: [],
    unreachableDomains: [],
    tiers,
  });

  it('diffs routable / health-only / listed when both snapshots have tiers', () => {
    const before = withTiers({
      routable: ['anclap.com'],
      healthOnly: ['mykobo.co'],
      listed: ['afreum.com'],
      excluded: [],
    });
    const after = withTiers({
      routable: ['anclap.com', 'zeam.money'],
      healthOnly: [],
      listed: ['afreum.com', 'mykobo.co'],
      excluded: [],
    });

    const diff = diffSnapshots(before, after);
    expect(hasChanges(diff)).toBe(true);
    expect(diff.routable.added).toEqual(['zeam.money']);
    expect(diff.healthOnly.removed).toEqual(['mykobo.co']);
    expect(diff.listed.added).toEqual(['mykobo.co']);

    const rendered = formatDiff(diff);
    // Tier sections appear, in routable -> health-only -> listed order.
    expect(rendered).toContain('Routable');
    expect(rendered).toContain('Health-only');
    expect(rendered).toContain('Listed');
    expect(rendered.indexOf('Routable')).toBeLessThan(rendered.indexOf('Listed'));
    expect(rendered).toContain('`zeam.money`');
  });

  it('reports no tier changes when tiers are identical', () => {
    const snap = withTiers({ routable: ['anclap.com'], healthOnly: [], listed: [], excluded: [] });
    const diff = diffSnapshots(snap, snap);
    expect(hasChanges(diff)).toBe(false);
    expect(formatDiff(diff)).toBe('No fleet changes since the last committed snapshot.');
  });

  it('skips tier sections when a snapshot predates tiers, without crashing', () => {
    const legacy = {
      transferCapableDomains: ['anclap.com'],
      issuerOnlyDomains: [],
      unreachableDomains: [],
    };
    const fresh = {
      transferCapableDomains: ['anclap.com'],
      issuerOnlyDomains: [],
      unreachableDomains: [],
      tiers: { routable: ['anclap.com'], healthOnly: [], listed: [], excluded: [] },
    };

    const diff = diffSnapshots(legacy, fresh);
    expect(diff.routable).toBeUndefined();
    expect(diff.healthOnly).toBeUndefined();
    expect(diff.listed).toBeUndefined();
    // No transfer-capable movement, and tiers were skipped, so nothing to report.
    expect(hasChanges(diff)).toBe(false);
    const rendered = formatDiff(diff);
    expect(rendered).not.toContain('Routable');
    expect(rendered).not.toContain('Health-only');
  });
});
