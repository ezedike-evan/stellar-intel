import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceDirectory = join(process.cwd(), 'contracts/reputation/src');
const document = readFileSync(join(process.cwd(), 'docs/grants/AUDIT_BANK_APPLICATION.md'), 'utf8');
const scope = document.split('## 2. Scope')[1]?.split('## 3.')[0] ?? '';
const modules = readdirSync(sourceDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.rs'))
  .map((entry) => entry.name)
  .sort();
const counts = Object.fromEntries(
  modules.map((name) => [
    name,
    [...readFileSync(join(sourceDirectory, name), 'utf8').matchAll(/\n/g)].length,
  ])
);

describe('Audit Bank application scope counts', () => {
  it('lists every source module exactly once with its wc -l count', () => {
    const rows = [...scope.matchAll(/^\|\s*`([^`]+\.rs)`\s*\|\s*(\d+)\s*\|/gm)];
    expect(
      rows.map((row) => row[1]).sort(),
      'Scope table must list every Rust module once'
    ).toEqual(modules);
    for (const row of rows) {
      const name = row[1] ?? '';
      const lines = row[2];
      expect(Number(lines), `Scope line count for ${name} has drifted`).toBe(counts[name]);
    }
  });

  it('keeps the headline and lib.rs entrypoint description in sync', () => {
    const headline = scope.match(
      /\*\*([\d,]+) lines of Rust across (\d+) modules\*\*, one contract, \*\*(\d+) public\s+entrypoints\*\*/
    );
    expect(headline, 'Scope headline is missing or has changed format').not.toBeNull();
    const lib = readFileSync(join(sourceDirectory, 'lib.rs'), 'utf8');
    // Match grep -c "pub fn": count matching lines, not occurrences.
    const entrypoints = lib.split('\n').filter((line) => line.includes('pub fn')).length;
    expect(Number(headline?.[1]?.replaceAll(',', ''))).toBe(
      Object.values(counts).reduce((sum, count) => sum + count, 0)
    );
    expect(Number(headline?.[2])).toBe(modules.length);
    expect(Number(headline?.[3])).toBe(entrypoints);
    const libRow = scope.split('\n').find((line) => /^\|\s*`lib\.rs`\s*\|/.test(line));
    expect(libRow).toContain(`all ${entrypoints} entrypoints`);
  });
});
