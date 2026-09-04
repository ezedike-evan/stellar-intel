/**
 * Landing-page smoke test (#533): the page renders its key sections and the
 * primary CTAs navigate correctly. Run by .github/workflows/preview-deploy.yml
 * against the deployed preview URL (PREVIEW_URL), or locally against the dev
 * server started by playwright.config.ts when PREVIEW_URL is unset.
 */
import { test, expect } from '@playwright/test';

if (process.env.PREVIEW_URL) {
  test.use({ baseURL: process.env.PREVIEW_URL });
}

test.describe('Landing page smoke test', () => {
  // Live-rate widgets (Hero, RatePreview) poll continuously, so the network
  // never goes idle — wait for the hero heading instead of 'networkidle'.
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('renders the hero heading and headline stats', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Health and reputation monitoring'
    );
    await expect(page.getByText('Anchors tracked')).toBeVisible();
    await expect(page.getByText('Corridors live')).toBeVisible();
    await expect(page.getByText('Countries reachable')).toBeVisible();
  });

  test('"Off-ramp now" CTA navigates to /offramp', async ({ page }) => {
    await page.getByRole('link', { name: 'Off-ramp now' }).click();
    // Generous timeout: a route visited for the first time against a local
    // `next dev` server compiles on demand, which can exceed the default 5s.
    await page.waitForURL(/\/offramp/, { timeout: 15000 });
  });

  test('"View anchors" CTA navigates to /anchors', async ({ page }) => {
    await page.getByRole('link', { name: 'View anchors' }).click();
    await page.waitForURL(/\/anchors/, { timeout: 15000 });
  });
});
