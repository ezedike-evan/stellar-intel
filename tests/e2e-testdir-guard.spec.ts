/**
 * tests/e2e-testdir-guard.spec.ts
 *
 * tests/e2e/ is Playwright's testDir (playwright.config.ts) and is excluded
 * from the vitest suite (vitest.config.mts's `exclude`). A vitest spec placed
 * under tests/e2e/ therefore never runs under vitest, and instead silently
 * breaks the entire Playwright runner at collection time. Browser tests do
 * not currently run in CI on fork PRs, so nobody would notice (#1030).
 *
 * This file must live outside tests/e2e/ so vitest actually runs it.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

const E2E_DIR = path.resolve(__dirname, 'e2e');
const VITEST_IMPORT = /from\s+['"]vitest(\/[^'"]*)?['"]|require\(\s*['"]vitest(\/[^'"]*)?['"]\s*\)/;

describe('tests/e2e stays Playwright-only (#1030)', () => {
  it('has no *.spec.ts file that imports from vitest', () => {
    const specFiles = readdirSync(E2E_DIR, { recursive: true })
      .filter((entry): entry is string => typeof entry === 'string' && entry.endsWith('.spec.ts'));

    const offenders = specFiles.filter((file) =>
      VITEST_IMPORT.test(readFileSync(path.join(E2E_DIR, file), 'utf8'))
    );

    if (offenders.length > 0) {
      throw new Error(
        `${offenders.map((f) => `tests/e2e/${f}`).join(', ')} ` +
          `import${offenders.length === 1 ? 's' : ''} from vitest, but tests/e2e/ is Playwright's ` +
          `testDir and is excluded from the vitest suite -- this file will never run and will ` +
          `also break the Playwright runner. Move it out of tests/e2e/ (e.g. tests/), or rewrite ` +
          `it as a Playwright test using @playwright/test instead of vitest.`
      );
    }

    expect(offenders).toEqual([]);
  });
});
