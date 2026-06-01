/**
 * Verifies the public /anchors leaderboard page renders and exposes sortable
 * anchor metrics.
 */
import { test, expect } from '@playwright/test';

test.describe('Anchor leaderboard page', () => {
  test('renders the leaderboard with sort headers and corridor filter', async ({ page }) => {
    await page.goto('/anchors');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('heading', { name: /The best Stellar anchor reputation scores/i })
    ).toBeVisible();
    await expect(page.getByRole('combobox', { name: /corridor/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Composite score/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Fill rate/i })).toBeVisible();
    await expect(page.locator('table tbody tr')).toHaveCount(3);
  });
});
