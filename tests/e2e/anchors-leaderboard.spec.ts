import { test, expect } from '@playwright/test';

test.describe('Route accessibility audit', () => {
  const routes = ['/', '/offramp', '/anchors', '/admin/disputes'];

  for (const route of routes) {
    test(`${route} has one h1, no skipped heading levels, and one main landmark`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState('networkidle');

      const levels = await page
        .locator('h1, h2, h3, h4, h5, h6')
        .evaluateAll((nodes) =>
          nodes.map((node) => Number.parseInt(node.tagName.replace('H', ''), 10))
        );

      expect(levels.filter((level) => level === 1)).toHaveLength(1);

      for (let index = 1; index < levels.length; index += 1) {
        expect(levels[index] - levels[index - 1]).toBeLessThanOrEqual(1);
      }

      await expect(page.locator('main')).toHaveCount(1);
    });
  }
});
