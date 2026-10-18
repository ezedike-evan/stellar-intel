// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The nightly and monthly workflows run these scripts under plain Node. Vitest
// rewrites imports into property reads on a module object, so a duplicate
// import name (a SyntaxError in Node) loads fine under it and the specs stay
// green. `node --check` parses each file the way the workflows do.
const SCRIPT_DIRS = ['scripts', join('scripts', 'lib')];

const scripts = SCRIPT_DIRS.flatMap((dir) =>
  readdirSync(join(process.cwd(), dir))
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => join(dir, name))
);

describe('scripts parse under plain Node', () => {
  it('finds the scripts to check', () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  it.each(scripts)('%s', (script) => {
    expect(() =>
      execFileSync(process.execPath, ['--check', script], {
        cwd: process.cwd(),
        stdio: 'pipe',
      })
    ).not.toThrow();
  });
});
