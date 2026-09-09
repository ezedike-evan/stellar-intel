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
    // Assert the selected state, not the class that paints it: the filter is
    // styled from theme tokens now, and asserting `bg-blue-600` kept this test
    // red for every restyle without ever checking that selection worked.
    await expect(corridorButtons.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(corridorButtons.first()).toHaveAttribute('aria-pressed', 'false');
  });
});
