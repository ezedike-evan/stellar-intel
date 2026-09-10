import type { NextConfig } from 'next';
import './lib/env';

const nextConfig: NextConfig = {
  // `graphql` loads from node_modules at runtime rather than being bundled. It
  // must exist as a single instance — its `instanceof` checks fail across
  // duplicated module realms, and bundling is how duplicates appear.
  // graphql-yoga is no longer a dependency; see app/api/graphql/route.ts.
  serverExternalPackages: ['graphql'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 86400,
  },

  /**
   * Keeps dev-only and browser-only files out of the Vercel Function bundles.
   *
   * Vercel bills `Functions Storage` per GB-month for the bundle of every route
   * in every retained deployment, in every region. A file traced into the
   * bundle is paid for once per entry point — 55 of them here — so anything a
   * function cannot execute at runtime is pure cost.
   *
   * Every entry below is unreachable in a deployed function, not merely
   * unused-looking:
   *   - `better-sqlite3` (13 MB, native binary) is a devDependency reached from
   *     nearly every route via lib/api/rate-limit -> ... -> lib/reputation/store.
   *     `resolveBackend` (lib/reputation/store.ts) returns `postgres` whenever
   *     `DATABASE_URL` is set *or* `NODE_ENV === 'production'`, both of which
   *     always hold on Vercel, so the SQLite branch never runs there. Setting
   *     `REPUTATION_BACKEND=sqlite` on a deployment would break that invariant.
   *   - `@stellar/stellar-sdk/dist` (15 MB) is the UMD browser bundle plus its
   *     source maps. The package's `exports` map only ever resolves to `lib/`.
   *   - the test/lint toolchain, `crates/`, `examples/` and `tests/` are
   *     build-time only.
   *
   * `docs/` and `scripts/` are deliberately NOT excluded: app/methodology and
   * app/terms read `docs/*.md` through `process.cwd()`, and app/api/mcp imports
   * `@/scripts/mcp/server`. Both are safe today — the pages prerender and the
   * import is bundled — but the margin is too thin for the bytes it would save.
   *
   * Excluding a file a function *does* need fails at runtime, not at build
   * time — verify a preview deployment before trusting a new entry here.
   */
  outputFileTracingExcludes: {
    '*': [
      'node_modules/better-sqlite3/**',
      'node_modules/@stellar/stellar-sdk/dist/**',
      'node_modules/**/*.map',
      'node_modules/**/*.md',
      'node_modules/typescript/**',
      'node_modules/@typescript-eslint/**',
      'node_modules/typescript-eslint/**',
      'node_modules/eslint/**',
      'node_modules/eslint-config-next/**',
      'node_modules/prettier/**',
      'node_modules/vitest/**',
      'node_modules/@vitest/**',
      'node_modules/@playwright/**',
      'node_modules/playwright/**',
      'node_modules/playwright-core/**',
      'node_modules/jsdom/**',
      'node_modules/happy-dom/**',
      'node_modules/msw/**',
      'node_modules/fast-check/**',
      'node_modules/esbuild/**',
      'node_modules/@esbuild/**',
      'node_modules/@testing-library/**',
      'crates/**',
      'examples/**',
      'tests/**',
      'packages/mcp/**',
      'packages/*/tests/**',
    ],
  },

  /**
   * `/api/mcp/ping` is served by the `/api/v1/health` function.
   *
   * Both are liveness probes returning a few bytes of JSON, but each route file
   * is its own Vercel Function bundle carrying its own copy of every traced
   * dependency. The rewrite keeps both public paths (and both documented
   * response bodies — see public/openapi.json) while deploying one function.
   *
   * `/api/publisher/health` is deliberately left alone: it reads the durable
   * outcome log, and it is the endpoint used to diagnose production runtime
   * config.
   */
  async rewrites() {
    return [{ source: '/api/mcp/ping', destination: '/api/v1/health?probe=mcp' }];
  },
};

export default nextConfig;
