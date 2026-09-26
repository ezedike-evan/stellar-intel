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
    const hero = page.getByRole('heading', { level: 1 });
    await expect(hero).toContainText('What anchors say.');
    await expect(hero).toContainText('What anchors did.');

    // Scoped to the coverage <section>: these three terms are ordinary words
    // that also occur in the body copy further down the page.
    const coverage = page.getByRole('region', { name: 'Registry coverage' });
    await expect(coverage.getByText('anchors', { exact: true })).toBeVisible();
    await expect(coverage.getByText('corridors', { exact: true })).toBeVisible();
    await expect(coverage.getByText('countries', { exact: true })).toBeVisible();
  });

  test('"See the record" CTA navigates to /anchors', async ({ page }) => {
    await page.getByRole('link', { name: 'See the record' }).click();
    // Generous timeout: a route visited for the first time against a local
    // `next dev` server compiles on demand. /offramp needed more than the 15s
    // this used to allow, so both navigations get the same headroom; against a
    // prebuilt server (CI, preview) they resolve immediately either way.
    await page.waitForURL(/\/anchors/, { timeout: 60000 });
  });

  test('the off-ramp comparator is reachable from the landing page', async ({ page }) => {
    // The hero's "compare all live rates" link only renders once a live rate
    // resolves — when the rate path is down the hero falls back to a variant
    // carrying no /offramp link at all. The header nav is the entry point that
    // is always present, so that is what this smoke test guards.
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await nav.getByRole('link', { name: 'Off-ramp' }).click();
    await page.waitForURL(/\/offramp/, { timeout: 60000 });
  });
});
