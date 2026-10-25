import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readListedAnchors, readListedDomains } from '../scripts/lib/listed-seeds.mjs';

// #1586: the listed operators' domains are survey candidates. These run against
// a throwaway directory, not constants/listed-anchors, so they do not move when
// an operator is added.

let dir;

function write(name, entry) {
  writeFileSync(join(dir, name), typeof entry === 'string' ? entry : JSON.stringify(entry));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'listed-seeds-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readListedAnchors', () => {
  it('reads every json file, sorted by file name, and ignores other files', () => {
    write('b-op.json', { id: 'b-op', domains: ['b.example'] });
    write('a-op.json', { id: 'a-op', domains: ['a.example'] });
    write('notes.txt', 'not json at all');

    expect(readListedAnchors({ dir }).map((e) => e.id)).toEqual(['a-op', 'b-op']);
  });

  it('returns an empty list for an empty directory', () => {
    expect(readListedAnchors({ dir })).toEqual([]);
  });

  it('throws with the file name when a file is not valid JSON', () => {
    write('good.json', { id: 'good', domains: ['good.example'] });
    write('broken.json', '{ "id": ');

    expect(() => readListedAnchors({ dir })).toThrow(/broken\.json/);
  });
});

describe('readListedDomains', () => {
  it('returns one candidate per domain with a listed:<id> source', () => {
    write('op-one.json', { id: 'op-one', domains: ['one.example', 'one-alt.example'] });

    expect(readListedDomains({ dir })).toEqual([
      { domain: 'one-alt.example', sources: ['listed:op-one'] },
      { domain: 'one.example', sources: ['listed:op-one'] },
    ]);
  });

  it('merges a domain shared by two entries, concatenating their sources', () => {
    write('op-a.json', { id: 'op-a', domains: ['shared.example', 'a.example'] });
    write('op-b.json', { id: 'op-b', domains: ['shared.example'] });

    const shared = readListedDomains({ dir }).find((c) => c.domain === 'shared.example');
    expect(shared.sources).toEqual(['listed:op-a', 'listed:op-b']);
  });

  it('lower-cases domains, so the same host in two cases is one candidate', () => {
    write('op-a.json', { id: 'op-a', domains: ['Mixed.Example'] });
    write('op-b.json', { id: 'op-b', domains: ['mixed.example'] });

    expect(readListedDomains({ dir })).toEqual([
      { domain: 'mixed.example', sources: ['listed:op-a', 'listed:op-b'] },
    ]);
  });

  it('sorts the result by domain', () => {
    write('op.json', { id: 'op', domains: ['zulu.example', 'alpha.example', 'mike.example'] });

    expect(readListedDomains({ dir }).map((c) => c.domain)).toEqual([
      'alpha.example',
      'mike.example',
      'zulu.example',
    ]);
  });

  it('skips an entry with no domains', () => {
    write('op.json', { id: 'op' });
    expect(readListedDomains({ dir })).toEqual([]);
  });

  it('throws with the file name when a file is not valid JSON', () => {
    write('broken.json', 'nope');
    expect(() => readListedDomains({ dir })).toThrow(/broken\.json/);
  });

  it('reads the real registry when no directory is given', () => {
    const candidates = readListedDomains();
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.domain).toBe(candidate.domain.toLowerCase());
      expect(candidate.sources.every((s) => s.startsWith('listed:'))).toBe(true);
    }
  });
});
