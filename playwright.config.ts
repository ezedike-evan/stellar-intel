import type { PlaywrightTestConfig } from '@playwright/test'
import { devices } from '@playwright/test'

const config: PlaywrightTestConfig = {
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
  },
  // Keep projects minimal; we run device emulation per spec via `test.use({ ... })`.
  // Limit to Chromium only; do not attempt to launch WebKit/Firefox.
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
      },
    },
  ],

}

export default config

// Export devices so specs can import from this file if desired.
export { devices }

