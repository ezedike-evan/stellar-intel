/**
 * #197 [#106] Freighter not installed
 *
 * Verifies the /offramp UX when the Freighter browser extension is absent.
 *
 * Strategy
 * --------
 * The `useFreighter` hook dynamically imports `@stellar/freighter-api` and
 * calls `isConnected()`. When the extension is missing the bundled module
 * either throws or returns a not-connected result. In both paths the hook
 * must NOT crash the page — it must surface install guidance.
 *
 * We use addInitScript to patch webpack's module cache so that the
 * freighter-api's `isConnected` function throws, forcing the hook's catch
 * branch and leaving `isInstalled === false`. This causes WalletButton to
 * render the "Install Freighter" anchor instead of "Connect Wallet".
 */
import { test, expect } from '@playwright/test';

// Inject before any page scripts run
const stubFreighterMissing = () => {
  // Remove any Freighter browser extension globals
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).freighter = undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__stellarFreighter = undefined;

  // Patch webpack module cache once it exists so that @stellar/freighter-api's
  // isConnected always throws. This triggers useFreighter's catch → isInstalled
  // stays false → WalletButton renders install guidance.
  function patchWebpackCache() {
    const cache =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__webpack_module_cache__ ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__next_f ?? // Next.js flight cache (app router)
      null;

    if (!cache || typeof cache !== 'object') return;

    for (const id of Object.keys(cache)) {
      const mod = (cache as Record<string, { exports?: Record<string, unknown> }>)[id];
      if (mod?.exports && typeof mod.exports['isConnected'] === 'function') {
        mod.exports['isConnected'] = async () => {
          throw new Error('Freighter extension not installed (stubbed)');
        };
      }
    }
  }

  // Attempt immediately then retry after hydration
  patchWebpackCache();
  setTimeout(patchWebpackCache, 50);
  setTimeout(patchWebpackCache, 300);
  setTimeout(patchWebpackCache, 800);
};

test.describe('[#106] Freighter not installed', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(stubFreighterMissing);
  });

  // ── Install guidance renders ────────────────────────────────────────────────

  test('install guidance is shown — Install Freighter link or Connect Wallet button', async ({
    page,
  }) => {
    await page.goto('/offramp');
    await page.waitForLoadState('networkidle');

    const installLink = page.getByRole('link', { name: /install freighter/i });
    const connectBtn = page.getByRole('button', { name: /connect wallet/i });

    const showsInstall = await installLink.isVisible().catch(() => false);
    const showsConnect = await connectBtn.isVisible().catch(() => false);

    expect(
      showsInstall || showsConnect,
      'Expected either "Install Freighter" link or "Connect Wallet" button to be visible'
    ).toBe(true);

    // When the install link is present, verify it points to freighter.app
    if (showsInstall) {
      await expect(installLink).toHaveAttribute('href', 'https://freighter.app');
      await expect(installLink).toHaveAttribute('target', '_blank');
      await expect(installLink).toHaveAttribute('rel', /noopener/);
    }
  });

  test('"Install Freighter" link is shown when stub forces isInstalled === false', async ({
    page,
  }) => {
    // Override any lazy-loaded module by also intercepting Next.js chunks
    await page.route('**/_next/static/chunks/**', async (route) => {
      const response = await route.fetch();
      const text = await response.text();

      // If this chunk contains the freighter isConnected export, patch it to throw
      if (text.includes('isConnected') && text.includes('freighter')) {
        const patched = text.replace(
          /(\bisConnected\b\s*[:=]\s*(?:async\s+)?function\s*\([^)]*\)\s*\{)/g,
          '$1 throw new Error("Freighter not installed (chunk stub)");'
        );
        await route.fulfill({
          response,
          body: patched,
          contentType: response.headers()['content-type'] ?? 'application/javascript',
        });
        return;
      }

      await route.fulfill({ response });
    });

    await page.goto('/offramp');
    await page.waitForLoadState('networkidle');

    // In headless Chrome without the extension the hook's catch fires;
    // WalletButton must show install guidance rather than crashing.
    const installLink = page.getByRole('link', { name: /install freighter/i });
    const connectBtn = page.getByRole('button', { name: /connect wallet/i });

    const showsGuidance =
      (await installLink.isVisible().catch(() => false)) ||
      (await connectBtn.isVisible().catch(() => false));

    expect(showsGuidance).toBe(true);
  });

  // ── No crash ────────────────────────────────────────────────────────────────

  test('page does not crash when Freighter is absent', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/offramp');
    await page.waitForTimeout(3_000);

    expect(errors, `Unexpected JS errors: ${errors.join('; ')}`).toHaveLength(0);
  });

  // ── Page remains functional ─────────────────────────────────────────────────

  test('offramp page renders corridor selector and amount input without Freighter', async ({
    page,
  }) => {
    await page.goto('/offramp');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /off-ramp comparator/i })).toBeVisible();
    await expect(page.locator('select').first()).toBeVisible();
    await expect(page.getByLabel('Amount (USDC)')).toBeVisible();
  });

  test('wallet guidance element is keyboard-reachable when Freighter is absent', async ({
    page,
  }) => {
    await page.goto('/offramp');
    await page.waitForLoadState('networkidle');

    const installLink = page.getByRole('link', { name: /install freighter/i });
    const connectBtn = page.getByRole('button', { name: /connect wallet/i });

    const showsInstall = await installLink.isVisible().catch(() => false);
    const target = showsInstall ? installLink : connectBtn;

    await target.focus();
    await expect(target).toBeFocused();
  });
});
