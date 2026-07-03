/**
 * ultracapital.xyz triage (B031).
 *
 * Triage result: NOT integrated.
 *
 * Findings (verified 2026-06-29):
 *   TOML      – present at https://ultracapital.xyz/.well-known/stellar.toml
 *   SEP-6     – TRANSFER_SERVER = https://ultracapital.xyz/sep6
 *   SEP-24    – TRANSFER_SERVER_SEP0024 = https://ultracapital.xyz/sep24
 *   /info     – withdraw assets: ETH, yUSDC, BTC, yBTC, yXLM, yETH
 *   Fiat?     – No. anchor_asset_type = "crypto" throughout; all assets are
 *               yield-bearing crypto tokens pegged to crypto (USDC, XLM, ETH).
 *
 * Decision: bucket as crypto-only yield platform. No fiat corridor exists, so
 * there is no USDC→fiat rate row to surface. Re-evaluate if a fiat asset is added.
 */

import { describe, it, expect } from 'vitest';
import { ANCHORS } from '@/constants/anchors';

describe('ultracapital.xyz triage (B031)', () => {
  it('is NOT registered in ANCHORS — crypto-only platform, no fiat off-ramp', () => {
    const ultracapital = ANCHORS.find((a) => a.homeDomain === 'ultracapital.xyz');
    expect(ultracapital).toBeUndefined();
  });

  it('no anchor id "ultracapital" exists in ANCHORS', () => {
    expect(ANCHORS.find((a) => a.id === 'ultracapital')).toBeUndefined();
  });
});
