import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';
const basePort = new URL(baseURL).port || '3000';
const webServerCommand = `npm run dev -- --port ${basePort}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: webServerCommand,
    url: baseURL,
    // The post-merge Playwright run (.github/workflows/postmerge-playwright.yml)
    // builds and starts the app itself via `next start` before invoking Playwright,
    // so it needs webServer to attach to that already-running server instead of
    // racing it for the port — hence the PW_REUSE_SERVER escape hatch from CI's
    // normal "always start a fresh server" default.
    reuseExistingServer: !process.env.CI || process.env.PW_REUSE_SERVER === 'true',
    timeout: 120_000,
  },
});
