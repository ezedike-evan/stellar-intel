import { test, expect } from '@playwright/test';
import {
  FAKE_PUBLIC_KEY,
  fakeFreighterInitScript,
  seedTemplatesInitScript,
} from './helpers/fake-freighter';
import { onrampQuoteResponse } from '../fixtures/onramp/deposit-e2e';

const FORCE_ONLINE = `Object.defineProperty(navigator, 'onLine', { get: () => true });`;

const SAMPLE_OFFRAMP_TEMPLATE = {
  schemaVersion: 1,
  id: 'tpl-off-kes',
  direction: 'offramp',
  label: 'Mum in Nairobi',
  corridorId: 'usdc-kes',
  amount: '150',
  createdAt: '2026-11-20T10:00:00Z',
  updatedAt: '2026-11-20T10:00:00Z',
};

const SAMPLE_ONRAMP_TEMPLATE = {
  schemaVersion: 1,
  id: 'tpl-on-ngn',
  direction: 'onramp',
  label: 'NGN Savings',
  corridorId: 'usdc-ngn',
  amount: '350',
  createdAt: '2026-11-20T10:00:00Z',
  updatedAt: '2026-11-20T10:00:00Z',
};

test.describe('Intent Templates E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(FORCE_ONLINE);
    await page.route('**/api/rates/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          corridorId: 'usdc-kes',
          rates: [],
          errors: [],
          lastFetchedAt: new Date().toISOString(),
        }),
      })
    );
    await page.route('https://horizon.stellar.org/**', (route) =>
      route.fulfill({ status: 404, body: '{}' })
    );
    await page.route('**/api/v1/onramp/quote**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(onrampQuoteResponse),
      })
    );
  });

  test('choosing a template on /offramp updates URL and amount input', async ({ page }) => {
    await page.addInitScript(fakeFreighterInitScript(FAKE_PUBLIC_KEY));
    await page.addInitScript(
      seedTemplatesInitScript(FAKE_PUBLIC_KEY, [SAMPLE_OFFRAMP_TEMPLATE])
    );

    await page.goto('/offramp');

    const select = page.getByLabel('Saved templates');
    await expect(select).toBeVisible();

    await select.selectOption({ label: 'Mum in Nairobi — 150 USDC → KES' });

    await expect(page).toHaveURL(/corridor=usdc-kes/);
    await expect(page).toHaveURL(/amount=150/);

    const amountInput = page.locator('#amount-input');
    await expect(amountInput).toHaveValue('150');
  });

  test('Manage templates -> rename -> reload persists the new name', async ({ page }) => {
    await page.addInitScript(fakeFreighterInitScript(FAKE_PUBLIC_KEY));
    await page.addInitScript(
      seedTemplatesInitScript(FAKE_PUBLIC_KEY, [SAMPLE_OFFRAMP_TEMPLATE])
    );

    await page.goto('/offramp');

    await page.getByRole('button', { name: 'Manage templates' }).click();
    await expect(page.getByRole('dialog', { name: 'Manage templates' })).toBeVisible();

    await page.getByRole('button', { name: 'Rename Mum in Nairobi' }).click();

    const nameInput = page.getByLabel('New name');
    await nameInput.fill('Mum in Mombasa');
    await page.getByRole('button', { name: 'Save' }).click();

    await page.getByRole('button', { name: 'Close' }).click();

    await page.reload();

    const select = page.getByLabel('Saved templates');
    await expect(select).toContainText('Mum in Mombasa');
  });

  test('Manage templates -> delete -> confirm -> reload removes the template', async ({
    page,
  }) => {
    await page.addInitScript(fakeFreighterInitScript(FAKE_PUBLIC_KEY));
    await page.addInitScript(
      seedTemplatesInitScript(FAKE_PUBLIC_KEY, [SAMPLE_OFFRAMP_TEMPLATE])
    );

    await page.goto('/offramp');

    await page.getByRole('button', { name: 'Manage templates' }).click();
    await page.getByRole('button', { name: 'Delete Mum in Nairobi' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Close' }).click();

    await page.reload();

    const select = page.getByLabel('Saved templates');
    await expect(select).not.toContainText('Mum in Nairobi');
  });

  test('/onramp with a seeded on-ramp template updates #deposit-amount', async ({ page }) => {
    await page.addInitScript(fakeFreighterInitScript(FAKE_PUBLIC_KEY));
    await page.addInitScript(
      seedTemplatesInitScript(FAKE_PUBLIC_KEY, [SAMPLE_ONRAMP_TEMPLATE])
    );

    await page.goto('/onramp');

    const select = page.getByLabel('Saved templates');
    await expect(select).toBeVisible();

    await select.selectOption({ label: 'NGN Savings — 350 NGN → USDC' });

    const depositInput = page.locator('#deposit-amount');
    await expect(depositInput).toHaveValue('350');
  });

  test('without fakeFreighterInitScript, the Saved templates control is absent', async ({
    page,
  }) => {
    await page.goto('/offramp');
    await expect(page.getByLabel('Saved templates')).toHaveCount(0);
  });
});
