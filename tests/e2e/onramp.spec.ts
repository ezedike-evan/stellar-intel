/**
 * #1097 — Golden-path onramp end-to-end: corridor selection through deposit
 * instructions, browser-level.
 *
 * Skipped for two independent reasons, both still open when this scaffold was
 * written:
 *
 * 1. No onramp UI exists yet. There is no `/onramp` route, no deposit form, no
 *    "start deposit" action anywhere in `app/` or `components/` — only
 *    router-internal deposit plumbing (`lib/router/connectors/on-ramp.ts`,
 *    which wraps `lib/stellar/sep24.ts`'s `initiateDeposit` for multi-hop
 *    routing, not a page a user visits) and the still-unimplemented SEP-6
 *    deposit scaffold (#1093). There is nothing in a browser to walk through.
 * 2. Even once there is, `tests/e2e` mixes Playwright specs with vitest files
 *    (#1027) and the preview-deploy smoke job still needs pointing at a real
 *    Playwright spec (#1028) before this directory reliably runs at all.
 *
 * The steps below are a best-effort forward guess at the golden path, grounded
 * in the equivalent `/offramp` flow's actual current UI (CorridorSelector,
 * `getByLabel('Amount (USDC)')`, an execute action, a status/result region —
 * see tests/e2e/keyboard-nav.spec.ts and tests/e2e/sep6-withdraw.spec.ts for
 * the real selectors those use today) rather than an invented shape. Update
 * every TODO against the real onramp UI once it ships, rather than assuming
 * this scaffold got it right on the first pass.
 */
import { test, expect } from '@playwright/test';

test.describe.skip('[#1097] Golden-path onramp: corridor selection to deposit instructions', () => {
  test('selects a corridor, enters an amount, and reaches deposit instructions', async ({
    page,
  }) => {
    // TODO: confirm the real route once the onramp page ships — mirrors
    // /offramp's naming, but that is an assumption, not a confirmed contract.
    await page.goto('/onramp');

    // ── Step 1: corridor selection ──────────────────────────────────────────
    // TODO: replace with the real corridor selector once it exists. /offramp's
    // CorridorSelector (components/offramp/CorridorSelector.tsx) is the closest
    // existing analogue — an onramp selector would plausibly expose the same
    // fiat-in / asset-out shape, just reversed.
    await page.getByRole('button', { name: /select corridor/i }).click();
    await page.getByRole('option', { name: /NGN.*USDC/i }).click();

    // ── Step 2: amount entry ────────────────────────────────────────────────
    // TODO: confirm the real label. /offramp uses exactly 'Amount (USDC)'
    // (tests/e2e/keyboard-nav.spec.ts) for the asset being withdrawn; an
    // onramp amount is more likely denominated in the fiat currency going in.
    await page.getByLabel(/Amount \(NGN\)/i).fill('50000');

    // ── Step 3: start the deposit ───────────────────────────────────────────
    await page.getByRole('button', { name: /deposit|start deposit/i }).click();

    // ── Step 4: deposit instructions render ─────────────────────────────────
    // The golden path ends at instructions, not completion — this spec covers
    // getting a user to "here is what to do next", not polling a transaction
    // through to a terminal state (that belongs with the SEP-6/SEP-24 status-
    // tracker coverage the withdraw side already has).
    //
    // TODO: the actual shape depends on which SEP the onramp UI ends up using:
    //   - SEP-24: an interactive_customer_info_needed redirect URL/iframe
    //     (mirrors lib/stellar/sep24.ts's initiateDeposit shape).
    //   - SEP-6 non-interactive: on-page instructions (a destination account,
    //     memo, min/max, ETA) once #1093's buildSep6DepositRequest lands.
    // Assert on whichever the shipped UI actually renders — this placeholder
    // checks only that *some* instructions region appears.
    await expect(page.getByTestId('deposit-instructions')).toBeVisible();
  });
});
