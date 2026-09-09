import { expect, test } from '@playwright/test';

const routes = ['/', '/anchors', '/offramp', '/admin/disputes'];

test.describe('route heading and landmark structure', () => {
  for (const route of routes) {
    test(`${route} has a valid document outline`, async ({ page }) => {
      await page.goto(route);

      await expect(page.locator('main')).toHaveCount(1);
      await expect(page.locator('header')).toHaveCount(1);
      await expect(page.locator('nav').first()).toBeVisible();
      await expect(page.locator('footer')).toHaveCount(1);
      await expect(page.locator('h1')).toHaveCount(1);

      const headingLevels = await page.locator('h1, h2, h3, h4, h5, h6').evaluateAll(
        (headings) => headings.map((heading) => Number(heading.tagName.slice(1))),
      );

      expect(headingLevels[0]).toBe(1);
      for (let index = 1; index < headingLevels.length; index += 1) {
        expect(headingLevels[index]).toBeLessThanOrEqual(headingLevels[index - 1] + 1);
      }
    });
  }
});