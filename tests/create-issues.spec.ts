import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

/**
 * A stand-in `gh` put first on PATH, so a dry run never reaches GitHub. The real
 * CLI made these tests depend on network, auth and the 5s test timeout, and the
 * CRLF case timed out under load. It answers `label list` with the labels the
 * fixtures use, and every other query with an empty list.
 */
function fakeGhDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fake-gh-'));
  const bin = join(dir, 'gh');
  writeFileSync(
    bin,
    `#!${process.execPath}
const args = process.argv.slice(2);
const labels = [{ name: 'feature' }, { name: 'module/ui' }];
process.stdout.write(JSON.stringify(args[0] === 'label' ? labels : []));
`
  );
  chmodSync(bin, 0o755);
  return dir;
}

describe('scripts/create-issues.mjs', () => {
  const scriptPath = join(process.cwd(), 'scripts', 'create-issues.mjs');
  const ghDir = fakeGhDir();

  function runScript(args: string[]) {
    try {
      const out = execFileSync(process.execPath, [scriptPath, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PATH: `${ghDir}${delimiter}${process.env.PATH ?? ''}` },
      });
      return { status: 0, stdout: out, stderr: '' };
    } catch (err: any) {
      return {
        status: err.status ?? 1,
        stdout: err.stdout?.toString() ?? '',
        stderr: err.stderr?.toString() ?? '',
      };
    }
  }

  it('prints usage and exits with code 2 when no catalog is provided', () => {
    const result = runScript([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: node scripts/create-issues.mjs');
  });

  it('fails with clear error if catalog has duplicate IDs', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'batch-test-'));
    const catalogPath = join(tmpDir, 'duplicate.md');
    writeFileSync(
      catalogPath,
      `#B001 [FEAT] [UI] First issue
Body 1
Labels: feature, module/ui

---

#B001 [FEAT] [UI] Duplicate issue
Body 2
Labels: feature, module/ui
`
    );

    const result = runScript([catalogPath]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('duplicate id');
  });

  it('fails with clear error if catalog is missing Labels: line', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'batch-test-'));
    const catalogPath = join(tmpDir, 'missing-labels.md');
    writeFileSync(
      catalogPath,
      `#B001 [FEAT] [UI] First issue
Body 1 without labels
`
    );

    const result = runScript([catalogPath]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('missing a "Labels:" line');
  });

  it('handles prettier-indented Labels: line and CRLF line endings', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'batch-test-'));
    const catalogPath = join(tmpDir, 'prettier-reflow.md');
    writeFileSync(
      catalogPath,
      '#B001 [FEAT] [UI] Reflowed issue\r\nSome body text\r\n  Labels: feature, module/ui\r\n'
    );

    // The dry run parses, then checks labels against the fake gh above.
    const result = runScript([catalogPath]);
    expect(result.stderr).not.toContain('missing a "Labels:" line');
    expect(result.stderr).not.toContain('duplicate id');
    expect(result.status).toBe(0);
  });

  it('exits with error if --only matches no blocks', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'batch-test-'));
    const catalogPath = join(tmpDir, 'only-test.md');
    writeFileSync(
      catalogPath,
      `#B001 [FEAT] [UI] First issue
Body 1
Labels: feature, module/ui
`
    );

    const result = runScript([catalogPath, '--only', 'B999']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('No blocks matched');
  });
});
