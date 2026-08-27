import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('scripts/create-issues.mjs', () => {
  const scriptPath = join(process.cwd(), 'scripts', 'create-issues.mjs');

  function runScript(args: string[]) {
    try {
      const out = execFileSync(process.execPath, [scriptPath, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
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

    // Dry run will attempt checkLabels/checkMilestones; check that parsing itself succeeds.
    // When labels or milestones checks run or fail, it should not fail on parse error.
    const result = runScript([catalogPath]);
    expect(result.stderr).not.toContain('missing a "Labels:" line');
    expect(result.stderr).not.toContain('duplicate id');
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
