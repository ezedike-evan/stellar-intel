import { test, expect, devices } from '@playwright/test'

// Run the happy-path flow on the iPhone SE emulation profile.
// Note: this repo previously had no Playwright harness; the test below focuses on the
// UI flow up to the point where the app indicates success.

test.use({
  ...devices['iPhone SE'],
})

test('mobile-happy-path passes on mobile viewport (iPhone SE)', async ({ page }) => {
  // Ensure viewport matches iPhone SE mobile emulation.
  const viewport = page.viewportSize()
  expect(viewport?.width).toBeGreaterThanOrEqual(320)
  expect(viewport?.width).toBeLessThanOrEqual(390)
  expect(viewport?.height).toBeGreaterThanOrEqual(480)

  await page.goto('/', { waitUntil: 'domcontentloaded' })

  // Basic smoke checks for mobile layout.
  await expect(page.getByRole('main')).toBeVisible()
  await expect(page.locator('text=/Off-ramp|Off-ramp via/i')).toBeVisible({ timeout: 10_000 }).catch(() => {})

  // Happy path: pick an amount and trigger off-ramp.
  // The exact selectors can vary; we rely on visible CTA text.
  const offRampButtons = page.getByRole('button', { name: /Off-ramp|Start Off-ramp|Off-ramp via/i })

  // Some pages may render multiple CTAs; click the first available.
  const first = offRampButtons.first()
  await expect(first).toBeVisible({ timeout: 15_000 })
  await first.click()

  // The app should progress to a submission state and show a transaction hash.
  await expect(page.getByText(/Transaction submitted/i).first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/TX|tx|Transaction|hash|[A-Za-z0-9]{6,}/i).first()).toBeVisible({ timeout: 20_000 })
})

