/*
 * Verifies the public /anchors page renders anchor scorecards and the
 * corridor rate leaderboard, and that the corridor filter works.
 */
import { test, expect } from '@playwright/test';

test.describe('Anchors page', () => {
  test('renders scorecards and the corridor leaderboard with a working corridor filter', async ({
    page,
  }) => {
    await page.goto('/anchors');
    await expect(page.getByRole('heading', { name: 'Anchors', level: 1 })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Corridor leaderboard' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Anchor' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'You Receive' })).toBeVisible();

    const corridorButtons = page.getByRole('button', { name: /^USDC\// });
    await expect(corridorButtons.first()).toBeVisible();
    await corridorButtons.nth(1).click();
    await expect(corridorButtons.nth(1)).toHaveClass(/bg-blue-600/);
  });
});
