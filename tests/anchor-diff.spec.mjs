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
