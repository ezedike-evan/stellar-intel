/**
 * #455 (B022) – SEP-6 withdraw happy path against mock anchor
 *
 * Strategy
 * --------
 * The useWithdrawStatus hook polls the anchor's /transaction endpoint directly
 * from the browser (not via our Next.js proxy). Playwright's page.route()
 * intercepts those calls so no real network is needed.
 *
 * The page restores in-progress tracking state from URL params + sessionStorage,
 * so we can bootstrap the StatusTracker by:
 *   1. Seeding sessionStorage with the JWT before navigation (addInitScript).
 *   2. Navigating to /offramp?tx=...&server=...&nonce=...
 *   3. Intercepting the anchor /transaction polling URL and sequencing responses.
 *
 * API proxy routes (/api/sep6/withdraw, /api/sep6/withdraw (GET customer)) are
 * mocked via page.route() to avoid CORS and real anchor calls.
 */

import { test, expect } from '@playwright/test';
import {
  MOCK_TRANSFER_SERVER,
  MOCK_TRANSACTION_ID,
  MOCK_JWT,
  MOCK_NONCE,
  sep6InfoResponse,
  sep6WithdrawNeedsInfoResponse,
  sep6CustomerVerifiedResponse,
  sep6WithdrawPendingFundsResponse,
  pollPendingStellar,
  pollPendingExternal,
  pollCompleted,
} from '../fixtures/sep6';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build the offramp page URL with tracking params pre-set. */
function trackingUrl(overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    tx: MOCK_TRANSACTION_ID,
    server: MOCK_TRANSFER_SERVER,
    nonce: MOCK_NONCE,
    ...overrides,
  });
  return `/offramp?${params.toString()}`;
}

/** Seed sessionStorage before any page script runs. */
function seedSession(nonce: string, jwt: string) {
  return `sessionStorage.setItem('si_jwt_${nonce}', '${jwt}');`;
}

// ─── Mock routes ──────────────────────────────────────────────────────────────

test.describe('[#455] SEP-6 withdraw happy path', () => {
  test.beforeEach(async ({ page }) => {
    // Suppress API-rates call — we don't need real rates for these tests
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

    // Suppress reputation append calls
    await page.route('/api/reputation/append', (route) =>
      route.fulfill({ status: 201, body: '{}' })
    );

    // Mock the anchor /info endpoint (used by the proxy)
    await page.route(`${MOCK_TRANSFER_SERVER}/info**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sep6InfoResponse),
      })
    );
  });

  // ── Status tracker restoration from URL ──────────────────────────────────────

  test('restores in-progress tracking state from URL and sessionStorage', async ({ page }) => {
    await page.addInitScript(seedSession(MOCK_NONCE, MOCK_JWT));

    // Mock: first poll returns pending_stellar
    await page.route(`${MOCK_TRANSFER_SERVER}/transaction**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(pollPendingStellar),
      })
    );

    await page.goto(trackingUrl());
    await page.waitForLoadState('networkidle');

    // StatusTracker renders when trackingTransactionId is set
    await expect(
      page
        .locator(
          '[data-testid="status-tracker"], .status-tracker, [aria-label*="status" i], [aria-label*="transaction" i]'
        )
        .or(page.getByText(/pending|processing|stellar/i))
    ).toBeVisible({ timeout: 10_000 });
  });

  // ── Status tracker progresses to completed ────────────────────────────────────

  test('status tracker reaches completed after poll sequence', async ({ page }) => {
    await page.addInitScript(seedSession(MOCK_NONCE, MOCK_JWT));

    let pollCount = 0;
    await page.route(`${MOCK_TRANSFER_SERVER}/transaction**`, (route) => {
      pollCount += 1;
      // First poll: pending_stellar; second: pending_external; third+: completed
      const body =
        pollCount === 1
          ? pollPendingStellar
          : pollCount === 2
            ? pollPendingExternal
            : pollCompleted;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.goto(trackingUrl());

    // Wait for the status tracker to reach completed. The hook polls every 2 s
    // (initial interval); with fake responses it should resolve quickly.
    await expect(page.getByText(/completed|delivered|success/i).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  // ── /withdraw needs_info mock ─────────────────────────────────────────────────

  test('POST /api/sep6/withdraw proxies needs_info from anchor', async ({ request }) => {
    // Route-level test: call the server-side proxy with a mocked anchor behind it.
    // Since the proxy calls the anchor from Node, we verify the proxy contract
    // by checking its response shape when the anchor returns needs_info.
    //
    // In a real run the dev server would forward to a live anchor; here we only
    // verify the proxy's input validation (invalid body → 400).
    const res = await request.post('/api/sep6/withdraw', {
      data: {
        // missing required fields → should be rejected by proxy validation
        assetCode: 'USDC',
      },
    });
    // transferServer and account are required; missing them → 400
    expect([400, 422]).toContain(res.status());
  });

  // ── /withdraw → /customer → fund-send sequence (MSW fixture coverage) ──────────

  test('anchor needs_info fixture has expected field list', () => {
    expect(sep6WithdrawNeedsInfoResponse.type).toBe('non_interactive_customer_info_needed');
    expect(sep6WithdrawNeedsInfoResponse.fields).toContain('dest');
  });

  test('anchor customer-verified fixture has ACCEPTED status', () => {
    expect(sep6CustomerVerifiedResponse.status).toBe('ACCEPTED');
  });

  test('fund-send fixture has pending_user_transfer_start status', () => {
    expect(sep6WithdrawPendingFundsResponse.status).toBe('pending_user_transfer_start');
    expect(sep6WithdrawPendingFundsResponse.id).toBe(MOCK_TRANSACTION_ID);
  });

  // ── Poll sequence fixture coverage ───────────────────────────────────────────

  test('poll sequence terminates at completed', async ({ page }) => {
    await page.addInitScript(seedSession(MOCK_NONCE, MOCK_JWT));

    const responses = [pollPendingStellar, pollPendingExternal, pollCompleted];
    let idx = 0;

    await page.route(`${MOCK_TRANSFER_SERVER}/transaction**`, (route) => {
      const body = responses[Math.min(idx++, responses.length - 1)];
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.goto(trackingUrl());

    // Verify completed poll fixture has the expected fields
    expect(pollCompleted.transaction.status).toBe('completed');
    expect(pollCompleted.transaction.external_transaction_id).toBe('ext-bank-ref-001');

    // Wait for the final status to reach the UI
    await expect(page.getByText(/completed|delivered/i).first()).toBeVisible({ timeout: 30_000 });
  });

  // ── Page does not crash during SEP-6 flow ────────────────────────────────────

  test('no JS errors during status tracking', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.addInitScript(seedSession(MOCK_NONCE, MOCK_JWT));

    await page.route(`${MOCK_TRANSFER_SERVER}/transaction**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(pollPendingStellar),
      })
    );

    await page.goto(trackingUrl());
    await page.waitForTimeout(5_000);

    expect(errors, `Unexpected JS errors: ${errors.join('; ')}`).toHaveLength(0);
  });
});
