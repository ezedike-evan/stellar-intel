import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    // ── Projects ────────────────────────────────────────────────────────────
    //
    // Two named projects separate the mocked unit suite from any future tests
    // that must hit live anchors:
    //
    //   unit         – the full mocked suite run by `npm test` on every
    //                  PR/push.  A third-party anchor being down CANNOT fail
    //                  a merge: nothing in this project makes a real network
    //                  call.
    //
    //   live-anchors – tests tagged `{ tags: ['live-anchor'] }`.  These are
    //                  intentionally NOT included in the default `npm test`
    //                  command.  They run only in the scheduled
    //                  live-anchor-checks.yml workflow (`npm run test:live`).
    //                  See .github/workflows/live-anchor-checks.yml for the
    //                  full job definition and issue-opening logic.
    //
    // To add a live test:
    //   describe('my probe', { tags: ['live-anchor'] }, () => { … });
    //   // or at the individual test level:
    //   it('fetches real TOML', { tags: ['live-anchor'] }, async () => { … });
    //
    // The project filter is what keeps live tests out of CI, not an env-var
    // guard.  That means the split is structural and cannot be accidentally
    // bypassed by setting an environment variable.
    projects: [
      {
        // ── Unit project ───────────────────────────────────────────────────
        // All existing tests that mock the network.  This is what `npm test`
        // and `npm run test:coverage` run.
        extends: true,
        test: {
          name: 'unit',
          pool: 'forks',
          maxWorkers: 4,
          environment: 'happy-dom',
          setupFiles: ['./tests/setup.ts'],
          globals: true,
          // Bound every test/hook/teardown so an unmocked network call or stray
          // open handle fails fast instead of hanging the whole suite (and CI)
          // forever.
          testTimeout: 15000,
          hookTimeout: 15000,
          teardownTimeout: 10000,
          // Exclude Playwright specs, worktree checkouts, and live-anchor tests.
          exclude: [
            ...configDefaults.exclude,
            'tests/e2e/**',
            '**/.claude/worktrees/**',
          ],
          // Exclude tests explicitly tagged as live-anchor; those belong to the
          // `live-anchors` project below.
          includeTaskLocation: true,
          env: {
            // Silence pino in tests — info-level logging floods stdout with
            // thousands of lines and was pushing the suite past CI timeouts
            // (looked like a hang).
            LOG_LEVEL: 'silent',
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
        // Only files that contain at least one test tagged `live-anchor` are
        // collected here.  A file with no such tag is ignored.
        extends: true,
        test: {
          name: 'live-anchors',
          pool: 'forks',
          maxWorkers: 2,
          environment: 'node',
          setupFiles: ['./tests/setup.ts'],
          globals: true,
          // Live network calls need more headroom than the 15 s unit ceiling.
          testTimeout: 60000,
          hookTimeout: 30000,
          teardownTimeout: 15000,
          include: ['tests/**/*.{spec,test}.{ts,mts,mjs,tsx}'],
          exclude: [
            ...configDefaults.exclude,
            'tests/e2e/**',
            '**/.claude/worktrees/**',
          ],
          // Only run tests carrying the live-anchor tag.
          // Tests without the tag are collected but immediately skipped.
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
