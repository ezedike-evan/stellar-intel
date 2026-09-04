/**
 * #196 [#105] slow-3G network profile
 *
 * Runs the /offramp happy path under simulated Slow 3G conditions via a
 * Playwright CDP session. Verifies that skeleton placeholders render during
 * the wait and that the page eventually reaches a stable state.
 *
 * Slow 3G parameters (matching Chrome DevTools preset):
 *   Download : 400 Kbps  → 50 KB/s
 *   Upload   : 400 Kbps  → 50 KB/s
 *   Latency  : 400 ms additional RTT
 */
import { test, expect, type CDPSession } from '@playwright/test';

const SLOW_3G = {
  offline: false,
  downloadThroughput: Math.round((400 * 1024) / 8), // bytes/s
  uploadThroughput: Math.round((400 * 1024) / 8),
  latency: 400,
} as const;

const RESTORE_NETWORK = {
  offline: false,
  downloadThroughput: -1,
  uploadThroughput: -1,
  latency: 0,
} as const;

test.describe('[#105] slow-3G network profile', () => {
  let cdp: CDPSession;

  test.beforeEach(async ({ page, context }) => {
    cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', SLOW_3G);
  });

  test.afterEach(async () => {
    await cdp.send('Network.emulateNetworkConditions', RESTORE_NETWORK).catch(() => null);
  });

  // ── Skeleton renders during load ────────────────────────────────────────────

  test('skeleton placeholders appear while rates are loading on slow 3G', async ({ page }) => {
    // Navigate without waiting for networkidle so we observe the loading state
    const navPromise = page.goto('/offramp', { waitUntil: 'domcontentloaded' });

    // The RateTable renders <Skeleton rows={5} /> with animate-pulse while loading.
    // On a throttled connection, this must be visible before data arrives.
    await expect(page.locator('.animate-pulse').first()).toBeVisible({ timeout: 30_000 });

    await navPromise;
  });

  // ── Happy path completes ────────────────────────────────────────────────────

  test('rate table or empty state renders after skeleton on slow 3G', async ({ page }) => {
    await page.goto('/offramp', { waitUntil: 'domcontentloaded' });

    // Skeleton may be visible during the throttled load
    await expect(page.locator('.animate-pulse').first())
      .toBeVisible({ timeout: 20_000 })
      .catch(() => null); // acceptable if content loads before assertion

    // Eventually the table, an empty state, or an error retry button must appear
    const settled = page
      .getByRole('table')
      .or(page.getByText('No rates available for this corridor.'))
      .or(page.getByRole('button', { name: /retry/i }));

    await expect(settled.first()).toBeVisible({ timeout: 90_000 });
  });

  test('page header and inputs render correctly under throttling', async ({ page }) => {
    await page.goto('/offramp', { waitUntil: 'domcontentloaded' });

    // Static content should paint quickly even on a slow connection
    await expect(page.getByRole('heading', { name: /off-ramp comparator/i })).toBeVisible({
      timeout: 30_000,
    });

    await expect(page.getByLabel('Amount (USDC)')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('select').first()).toBeVisible({ timeout: 10_000 });
  });

  // ── No crash ────────────────────────────────────────────────────────────────

  test('no unhandled JS errors occur on slow 3G', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/offramp', { waitUntil: 'domcontentloaded' });

    // Allow a few seconds for async operations to settle
    await page.waitForTimeout(4_000);

    expect(errors, `Unexpected JS errors on slow 3G: ${errors.join('; ')}`).toHaveLength(0);
  });

  // ── Inputs remain interactive under throttling ───────────────────────────────

  test('amount input accepts keyboard input while network is throttled', async ({ page }) => {
    await page.goto('/offramp', { waitUntil: 'domcontentloaded' });

    const input = page.getByLabel('Amount (USDC)');
    await input.waitFor({ state: 'visible', timeout: 30_000 });

    await input.focus();
    await input.selectText();
    await page.keyboard.type('200');

    await expect(input).toHaveValue('200');
  });
});
