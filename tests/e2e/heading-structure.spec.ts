import { expect, test } from '@playwright/test';

// Every page route under app/. `/anchors/[id]` is exercised through one real anchor.
const routes = [
  '/',
  '/admin/disputes',
  '/anchors',
  '/anchors/moneygram',
  '/anchors/standings',
  '/docs',
  '/docs/api',
  '/docs/auth',
  '/docs/mcp',
  '/docs/quickstart',
  '/docs/sdks',
  '/docs/webhooks',
  '/faq',
  '/history',
  '/methodology',
  '/offramp',
  '/terms',
];

test.describe('route heading and landmark structure', () => {
  for (const route of routes) {
    test(`${route} has a valid document outline`, async ({ page }) => {
      await page.goto(route);

      // Exactly one of each top-level landmark; a nested <main> is a second one.
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('banner')).toHaveCount(1);
      await expect(page.getByRole('contentinfo')).toHaveCount(1);
      await expect(page.locator('h1')).toHaveCount(1);

      const headingLevels = await page
        .locator('h1, h2, h3, h4, h5, h6')
        .evaluateAll((headings) => headings.map((heading) => Number(heading.tagName.slice(1))));

      // The outline starts at h1 and never skips a level going down.
      expect(headingLevels[0]).toBe(1);
      for (let index = 1; index < headingLevels.length; index += 1) {
        expect(headingLevels[index]).toBeLessThanOrEqual(headingLevels[index - 1]! + 1);
      }
    });
  }
});
