/**
 * #721 [D035] – SEP-24 live execution flow verification for USDC→NGN corridor
 *
 * Requirements:
 * 1. Execute a full SEP-24 interactive withdraw for USDC→NGN on an anchor from start to completed/pending-external status.
 * 2. Confirm StatusTracker correctly reflects each state transition during the run.
 * 3. Verify accurate status labels, timelines, amounts, bank transfer IDs, and Stellar transaction links.
 */

import { test, expect } from '@playwright/test';
import {
  MOCK_SEP24_TRANSFER_SERVER,
  MOCK_SEP24_TRANSACTION_ID,
  MOCK_SEP24_JWT,
  MOCK_SEP24_NONCE,
  sep24InfoResponse,
  pollSep24UserTransferStart,
  pollSep24UserTransferComplete,
  pollSep24PendingAnchor,
  pollSep24PendingExternal,
  pollSep24Completed,
} from '../fixtures/sep24';

function trackingUrl(overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    tx: MOCK_SEP24_TRANSACTION_ID,
    server: MOCK_SEP24_TRANSFER_SERVER,
    nonce: MOCK_SEP24_NONCE,
    asset: 'USDC',
    currency: 'NGN',
    ...overrides,
  });
  return `/offramp?${params.toString()}`;
}

function seedSession(nonce: string, jwt: string) {
  return `sessionStorage.setItem('si_jwt_${nonce}', '${jwt}');`;
}

test.describe('[#721] SEP-24 live execution flow (USDC→NGN corridor)', () => {
  test.beforeEach(async ({ page }) => {
    // Mock API rates call to prevent background network noise
    await page.route('/api/rates**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          corridorId: 'usdc-ngn',
          rates: [],
          pending: [],
          bestRateId: '',
          errors: [],
        }),
      })
    );

    // Mock reputation append route
    await page.route('/api/reputation/append', (route) =>
      route.fulfill({ status: 201, body: '{}' })
    );

    // Mock anchor SEP-24 /info
    await page.route(`${MOCK_SEP24_TRANSFER_SERVER}/info**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sep24InfoResponse),
      })
    );
  });

  test('StatusTracker reflects state transitions through to completed status', async ({ page }) => {
    await page.addInitScript(seedSession(MOCK_SEP24_NONCE, MOCK_SEP24_JWT));

    const pollSequence = [
      pollSep24UserTransferStart,
      pollSep24UserTransferComplete,
      pollSep24PendingAnchor,
      pollSep24PendingExternal,
      pollSep24Completed,
    ];

    let pollIndex = 0;
    await page.route(`${MOCK_SEP24_TRANSFER_SERVER}/transaction**`, (route) => {
      const response = pollSequence[Math.min(pollIndex++, pollSequence.length - 1)];
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
    });

    await page.goto(trackingUrl());

    // 1. Initial state: pending_user_transfer_start -> "Awaiting your payment"
    await expect(page.getByText('Awaiting your payment')).toBeVisible({ timeout: 10_000 });

    // 2. Final state: completed -> "Completed" & "Delivered" with bank transfer ID
    await expect(page.getByText('Completed').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Delivered')).toBeVisible();
    await expect(page.getByText('ngn-bank-ref-721')).toBeVisible();
    await expect(page.getByText('View transaction history')).toBeVisible();
  });

  test('StatusTracker reaches terminal pending_external state accurately', async ({ page }) => {
    await page.addInitScript(seedSession(MOCK_SEP24_NONCE, MOCK_SEP24_JWT));

    await page.route(`${MOCK_SEP24_TRANSFER_SERVER}/transaction**`, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(pollSep24PendingExternal),
      });
    });

    await page.goto(trackingUrl());

    await expect(page.getByText('Sending to bank')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('ngn-bank-ref-721')).toBeVisible();
    await expect(page.getByText('Live')).toBeVisible();
  });

  test('no JS errors during full SEP-24 execution flow', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.addInitScript(seedSession(MOCK_SEP24_NONCE, MOCK_SEP24_JWT));

    let pollIndex = 0;
    const pollSequence = [pollSep24UserTransferStart, pollSep24PendingExternal, pollSep24Completed];

    await page.route(`${MOCK_SEP24_TRANSFER_SERVER}/transaction**`, (route) => {
      const response = pollSequence[Math.min(pollIndex++, pollSequence.length - 1)];
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
    });

    await page.goto(trackingUrl());
    await page.waitForTimeout(5_000);

    expect(errors, `Unexpected JS errors: ${errors.join('; ')}`).toHaveLength(0);
  });
});
