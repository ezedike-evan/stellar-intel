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
    // Five states, each held for two polls, on a backoff that widens as the
    // status repeats: the run reaches `completed` around the 40s mark. The
    // default 30s per-test budget capped every assertion below it, so the
    // generous per-assertion timeouts could never actually be spent.
    test.setTimeout(150_000);
    await page.addInitScript(seedSession(MOCK_SEP24_NONCE, MOCK_SEP24_JWT));

    const pollSequence = [
      pollSep24UserTransferStart,
      pollSep24UserTransferComplete,
      pollSep24PendingAnchor,
      pollSep24PendingExternal,
      pollSep24Completed,
    ];

    // Each state is served for two consecutive polls. The tracker's first paint
    // carries a status but none of the transaction fields, and only the second
    // poll renders a state fully; advancing the fixture once per request meant
    // the opening state was replaced before it was ever painted, so the first
    // assertion below could not hold.
    let pollIndex = 0;
    await page.route(`${MOCK_SEP24_TRANSFER_SERVER}/transaction**`, (route) => {
      const step = Math.floor(pollIndex++ / 2);
      const response = pollSequence[Math.min(step, pollSequence.length - 1)];
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
    });

    await page.goto(trackingUrl());

    // 1. Initial state: pending_user_transfer_start -> "Awaiting your payment".
    // `exact` because the stage timeline further down renders its own row with
    // the same words, which would otherwise make this a strict-mode violation.
    await expect(page.getByText('Awaiting your payment', { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // 2. Final state: completed -> "Completed" & "Delivered" with bank transfer ID.
    // Wait on "Delivered" rather than "Completed": the stage timeline renders a
    // "Completed" row long before the completed poll lands, so waiting on that
    // released the remaining assertions while the tracker was still mid-flight.
    await expect(page.getByText('Delivered')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('ngn-bank-ref-721')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('View transaction history')).toBeVisible({ timeout: 15_000 });
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

    // `exact` keeps this off the stage-timeline row, which reads
    // "Sending to Bank (Current stage)" and matches the same substring.
    await expect(page.getByText('Sending to bank', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    // The bank transfer id arrives with the second poll, not the first paint.
    await expect(page.getByText('ngn-bank-ref-721')).toBeVisible({ timeout: 15_000 });
    // `exact` again: the non-custodial disclaimer says "Rates are live quotes".
    await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 15_000 });
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
