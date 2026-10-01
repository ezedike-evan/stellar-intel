import { describe, it, expect } from 'vitest';
import { tierOf } from '../scripts/anchor-survey.mjs';

// #1319 — every surveyed domain is classified into one of four fleet tiers.
// One fixture per tier, mirroring the shapes the multi-source survey produces.

describe('anchor-survey: tierOf', () => {
  it('classifies a live withdraw rail (SEP-24 exchange-only USDC) as routable', () => {
    // Latamex-like: SEP-24 /info offers no plain withdraw asset, only an
    // exchange withdraw for USDC. A single enabled withdraw code is enough.
    const latamex = {
      domain: 'latamex.example',
      reachable: true,
      sep6: false,
      sep24: true,
      sep31: false,
      rails: {
        sep24: { ok: true, withdraw: [], withdrawExchange: ['USDC'] },
      },
    };
    expect(tierOf(latamex)).toBe('routable');
  });

  it('classifies a SEP-6 anchor whose /info probe failed as health-only', () => {
    const infoDown = {
      domain: 'info-down.example',
      reachable: true,
      sep6: true,
      sep24: false,
      sep31: false,
      rails: {
        sep6: { ok: false },
      },
    };
    expect(tierOf(infoDown)).toBe('health-only');
  });

  it('classifies a SEP-31-only anchor as health-only', () => {
    const sep31Only = {
      domain: 'payments-only.example',
      reachable: true,
      sep6: false,
      sep24: false,
      sep31: true,
    };
    expect(tierOf(sep31Only)).toBe('health-only');
  });

  it('classifies a reachable issuer-only toml as listed', () => {
    const issuerOnly = {
      domain: 'issuer.example',
      reachable: true,
      sep6: false,
      sep24: false,
      sep31: false,
    };
    expect(tierOf(issuerOnly)).toBe('listed');
  });

  it('classifies an unreachable domain as listed', () => {
    const dead = { domain: 'dead.example', reachable: false, reason: 'HTTP 404' };
    expect(tierOf(dead)).toBe('listed');
  });

  it('classifies an impersonation result as excluded, ahead of any rail', () => {
    const impersonator = {
      domain: 'impersonator.example',
      reachable: true,
      sep6: true,
      sep24: true,
      excluded: 'impersonates cowrie.exchange',
      rails: {
        sep24: { ok: true, withdraw: ['USDC'] },
      },
    };
    expect(tierOf(impersonator)).toBe('excluded');
  });

  it('does not treat an advertised-but-unprobed rail as routable', () => {
    // A toml-only result: the SEP is advertised but no /info withdraw asset is
    // confirmed, so it must not be counted routable.
    const advertisedOnly = {
      domain: 'advertised.example',
      reachable: true,
      sep6: true,
      sep24: true,
    };
    expect(tierOf(advertisedOnly)).toBe('health-only');
  });
});
