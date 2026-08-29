import { test, expect } from '@playwright/test';

test.describe('Anchor detail page', () => {
  test('ships score, history chart, corridors list, and oracle tx link', async ({ page }) => {
    await page.goto('/anchors/cowrie');

    await expect(page.getByRole('heading', { name: /Cowrie Exchange/i })).toBeVisible();
    await expect(page.getByTestId('anchor-score')).toBeVisible();
    await expect(page.getByTestId('anchor-history-chart')).toBeVisible();
    await expect(page.getByTestId('anchor-corridors')).toBeVisible();
    await expect(page.getByTestId('anchor-corridors').getByText(/USDC\/NGN/i)).toBeVisible();

    const oracleLink = page.getByTestId('anchor-oracle-link');
    const oracleEmpty = page.getByText(/No oracle transaction yet\./i);

    if (await oracleLink.count()) {
      await expect(oracleLink).toBeVisible();
      await expect(oracleLink).toHaveAttribute('href', /\/tx\/[0-9a-fA-F]{64}$/);
    } else {
      await expect(oracleEmpty).toBeVisible();
    }
  });
});
