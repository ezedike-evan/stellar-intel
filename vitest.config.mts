import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  test: {
    pool: 'threads',
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    // Bound every test/hook/teardown so an unmocked network call or stray open
    // handle fails fast instead of hanging the whole suite (and CI) forever.
    testTimeout: 15000,
    hookTimeout: 15000,
    teardownTimeout: 10000,
    // tests/e2e is Playwright's testDir (see playwright.config.ts); vitest must
    // not run those specs or they fail on Playwright's test.describe().
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    env: {
      // Silence pino in tests — info-level logging floods stdout with thousands
      // of lines and was pushing the suite past CI timeouts (looked like a hang).
      LOG_LEVEL: 'silent',
      NEXT_PUBLIC_STELLAR_NETWORK: 'mainnet',
      NEXT_PUBLIC_HORIZON_URL: 'https://horizon.stellar.org',
      NEXT_PUBLIC_USDC_ISSUER: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      NEXT_PUBLIC_APP_NAME: 'Stellar Intel',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, '.'),
    },
  },
})
