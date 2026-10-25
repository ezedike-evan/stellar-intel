import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    // teardownTimeout is a NonProjectOptions field in vitest ≥ 4 and cannot
    // appear inside a project's test block.  Set it once at the top level so
    // it applies to every project in the workspace.
    teardownTimeout: 15000,
    // ── Projects ────────────────────────────────────────────────────────────
    //
    // Two named projects separate the mocked unit suite from the tests that must
    // hit live anchors, by directory:
    //
    //   unit         – the full mocked suite run by `npm test` on every
    //                  PR/push.  A third-party anchor being down CANNOT fail
    //                  a merge: nothing in this project makes a real network
    //                  call.  It excludes `tests/live/**`.
    //
    //   live-anchors – only `tests/live/**/*.live.spec.ts`.  These are
    //                  intentionally NOT part of `npm test`.  They run only in
    //                  the scheduled live-anchor-checks.yml workflow
    //                  (`npm run test:live`); see that file for the job
    //                  definition and issue-opening logic.
    //
    // To add a live test, put it in `tests/live/<name>.live.spec.ts`.
    //
    // The split is by directory, so it is structural: a spec outside
    // `tests/live/` can never run in the live project, and one inside it can
    // never run in CI, whatever environment variables are set.
    projects: [
      {
        // ── Unit project ───────────────────────────────────────────────────
        // All existing tests that mock the network.  This is what `npm test`
        // and `npm run test:coverage` run.
        extends: true,
        test: {
          name: 'unit',
          // Vitest refuses to start when two projects have different
          // `maxWorkers` but the same `sequence.groupOrder`, so give each project
          // its own. Without this a plain `npx vitest run <file>` aborts.
          sequence: { groupOrder: 0 },
          pool: 'forks',
          maxWorkers: 4,
          environment: 'happy-dom',
          setupFiles: ['./tests/setup.ts'],
          globals: true,
          // Vitest 4: vi.restoreAllMocks() does not undo vi.stubGlobal().
          // Enabling unstubGlobals ensures global stubs set during a test or beforeEach
          // are automatically cleared before the next test, preventing global leaks.
          unstubGlobals: true,
          // Bound every test/hook so an unmocked network call or stray
          // open handle fails fast instead of hanging the whole suite (and CI)
          // forever.  teardownTimeout is set at the top level (NonProjectOptions).
          testTimeout: 15000,
          hookTimeout: 15000,
          // Exclude Playwright specs, worktree checkouts, and the live-anchor
          // tests, which belong to the `live-anchors` project below.
          exclude: [
            ...configDefaults.exclude,
            'tests/e2e/**',
            'tests/live/**',
            '**/.claude/worktrees/**',
          ],
          includeTaskLocation: true,
          env: {
            // Silence pino in tests — info-level logging floods stdout with
            // thousands of lines and was pushing the suite past CI timeouts
            // (looked like a hang).
            LOG_LEVEL: 'silent',
            // The unit suite must never talk to a real database. Blanking
            // DATABASE_URL prevents specs from inheriting an ambient Postgres
            // connection string from the developer's shell or .env.local.
            DATABASE_URL: '',
            NEXT_PUBLIC_STELLAR_NETWORK: 'mainnet',
            NEXT_PUBLIC_HORIZON_URL: 'https://horizon.stellar.org',
            NEXT_PUBLIC_USDC_ISSUER: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
            NEXT_PUBLIC_APP_NAME: 'Stellar Intel',
            CRON_SECRET: 'test-secret',
          },
        },
      },
      {
        // ── Live-anchors project ───────────────────────────────────────────
        // Tests that make real network calls to registered anchors.
        // Run exclusively by the scheduled live-anchor-checks.yml workflow.
        //
        // Only `tests/live/**/*.live.spec.ts` is collected here.
        extends: true,
        test: {
          name: 'live-anchors',
          // A unique group order is required because `maxWorkers` differs from
          // the unit project's; see the note on that project.
          sequence: { groupOrder: 1 },
          pool: 'forks',
          maxWorkers: 2,
          environment: 'node',
          setupFiles: ['./tests/setup.ts'],
          globals: true,
          // Live network calls need more headroom than the 15 s unit ceiling.
          // teardownTimeout is set at the top level (NonProjectOptions).
          testTimeout: 60000,
          hookTimeout: 30000,
          // `npm run test:live` passes --passWithNoTests (a root-only option), so
          // the scheduled job still passes while this directory is empty.
          include: ['tests/live/**/*.live.spec.ts'],
          exclude: [...configDefaults.exclude, '**/.claude/worktrees/**'],
          includeTaskLocation: true,
          env: {
            LOG_LEVEL: 'silent',
            NEXT_PUBLIC_STELLAR_NETWORK: 'mainnet',
            NEXT_PUBLIC_HORIZON_URL: 'https://horizon.stellar.org',
            NEXT_PUBLIC_USDC_ISSUER: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
            NEXT_PUBLIC_APP_NAME: 'Stellar Intel',
            CRON_SECRET: 'test-secret',
          },
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, '.'),
    },
  },
});
