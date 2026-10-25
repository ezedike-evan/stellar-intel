// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORRIDORS } from '@/constants/anchors';

// `migrate_all_v2` walks a corridor list compiled into the contract. It had
// drifted from the app's corridors, so a fleet migration silently skipped six
// of them (#1397). The two lists must now change together.

const source = readFileSync(join(process.cwd(), 'contracts/reputation/src/migration.rs'), 'utf8');

function v2Corridors(): string[] {
  const block = /const V2_CORRIDORS: &\[&str\] = &\[([\s\S]*?)\];/.exec(source);
  expect(block, 'V2_CORRIDORS not found in migration.rs').not.toBeNull();
  return [...(block?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '');
}

describe('contract V2_CORRIDORS (#1397)', () => {
  it('is exactly the app corridor ids, in the same order', () => {
    expect(v2Corridors()).toEqual(CORRIDORS.map((c) => c.id));
  });

  it('lists each corridor once', () => {
    const ids = v2Corridors();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('documents the same list in ORACLE_MIGRATION.md', () => {
    const doc = readFileSync(join(process.cwd(), 'docs/ORACLE_MIGRATION.md'), 'utf8');
    const block = /const V2_CORRIDORS: &\[&str\] = &\[([\s\S]*?)\];/.exec(doc);
    const documented = [...(block?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '');
    expect(documented).toEqual(v2Corridors());
  });
});
