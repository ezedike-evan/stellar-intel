/**
 * /onramp in a browser, against a mocked anchor and a mocked quote API.
 *
 * The quote endpoint, the reputation append and the anchor's SEP-24 /transaction
 * are all stubbed with page.route, so nothing leaves the machine. Freighter is not
 * installed in these runs, which is the no-wallet case the page has to handle.
 */
import { test, expect } from '@playwright/test';
import {
  ONRAMP_E2E_BANK_REFERENCE,
  ONRAMP_E2E_JWT,
  ONRAMP_E2E_NONCE,
  ONRAMP_E2E_STELLAR_TX,
  ONRAMP_E2E_TRANSACTION_ID,
  ONRAMP_E2E_TRANSFER_SERVER,
  depositPollSequence,
  onrampQuoteResponse,
} from '../fixtures/onramp/deposit-e2e';

const CAPTION =
  'Estimates only. Each anchor sets its final rate and fees inside its deposit window.';

function trackingUrl(): string {
  const params = new URLSearchParams({
    tx: ONRAMP_E2E_TRANSACTION_ID,
    server: ONRAMP_E2E_TRANSFER_SERVER,
    nonce: ONRAMP_E2E_NONCE,
  });
  return `/onramp?${params.toString()}`;
}

// Every call is stubbed, but SWR still pauses while the browser reports itself offline,
// which a runner without a working default route does. Pin it online so the spec
// depends on its own mocks and not on the host's network.
const FORCE_ONLINE = `Object.defineProperty(navigator, 'onLine', { get: () => true });`;

// Under `next dev` the first request to a route compiles it; give the first
// assertion on a fresh page room for that.
const FIRST_PAINT = { timeout: 30_000 };

test.describe('/onramp', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(FORCE_ONLINE);
    await page.route('**/api/v1/onramp/quote**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(onrampQuoteResponse),
      })
    );
    await page.route('**/api/reputation/append', (route) =>
      route.fulfill({ status: 201, body: '{}' })
    );
  });

  test('renders the estimate table with the indicative caption', async ({ page }) => {
    await page.goto('/onramp?corridor=usdc-ngn&amount=10000');

    await expect(page.getByRole('heading', { name: 'On-ramp Comparator' })).toBeVisible(
      FIRST_PAINT
    );
    await expect(page.getByText(CAPTION)).toBeVisible();

    // Two anchors, each an estimate, best first.
    await expect(page.getByRole('link', { name: 'Cowrie' })).toBeVisible(FIRST_PAINT);
    await expect(page.getByRole('link', { name: 'MoneyGram' })).toBeVisible();
    await expect(page.getByText('≈ 5.95 USDC')).toBeVisible();
    await expect(page.getByText('≈ 5.25 USDC')).toBeVisible();
    await expect(page.getByText('Best estimate')).toBeVisible();
  });

  test('shows the connect prompt and disables Deposit when no wallet is connected', async ({
    page,
  }) => {
    await page.goto('/onramp?corridor=usdc-ngn&amount=10000');

    await expect(page.getByText('Connect your Freighter wallet to deposit.')).toBeVisible(
      FIRST_PAINT
    );
    await expect(page.getByRole('button', { name: 'Deposit with Cowrie' })).toBeDisabled(
      FIRST_PAINT
    );
    await expect(page.getByRole('button', { name: 'Deposit with MoneyGram' })).toBeDisabled();
  });

  test('resumes a tracked deposit: instructions first, then the credited amount', async ({
    page,
  }) => {
    // Each state is served for two polls, as in the withdraw spec: the tracker's
    // first paint carries a status but not every field.
    test.setTimeout(150_000);
    await page.addInitScript(
      `sessionStorage.setItem('si_jwt_${ONRAMP_E2E_NONCE}', '${ONRAMP_E2E_JWT}');`
    );
    let polls = 0;
    await page.route(`${ONRAMP_E2E_TRANSFER_SERVER}/transaction**`, (route) => {
      const step = Math.floor(polls++ / 2);
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(depositPollSequence[Math.min(step, depositPollSequence.length - 1)]),
      });
    });

    await page.goto(trackingUrl());

    // The user still has to pay: the status says so and the anchor's details are
    // there to copy.
    await expect(page.getByText('Send payment to anchor', { exact: true })).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByText('0123456789')).toBeVisible();
    await expect(page.getByText(ONRAMP_E2E_BANK_REFERENCE)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy Bank account number' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy Payment reference' })).toBeVisible();

    // Completed: the amount credited and the Stellar transaction.
    await expect(page.getByText('You received 5.95 USDC')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('Deposit complete')).toBeVisible();
    await expect(page.getByRole('link', { name: /view transaction/i })).toHaveAttribute(
      'href',
      new RegExp(`/tx/${ONRAMP_E2E_STELLAR_TX}$`)
    );

    // Once paid there is nothing left to copy.
    await expect(page.getByRole('button', { name: 'Copy Payment reference' })).toHaveCount(0);
  });

  test('renders no tracker when the session no longer holds the JWT', async ({ page }) => {
    await page.route(`${ONRAMP_E2E_TRANSFER_SERVER}/transaction**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(depositPollSequence[0]),
      })
    );

    await page.goto(trackingUrl());

    await expect(page.getByRole('heading', { name: 'On-ramp Comparator' })).toBeVisible();
    await expect(page.getByText('Deposit status')).toHaveCount(0);
  });
});
