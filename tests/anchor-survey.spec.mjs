import { describe, it, expect, vi } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { PROBE_ACCOUNT, checkSep10Liveness, tierOf } from '../scripts/anchor-survey.mjs';

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

const MONEYGRAM_AUTH = 'https://stellar.moneygram.com/stellaradapterservice/auth';

describe('anchor-survey: PROBE_ACCOUNT', () => {
  it('is a valid Stellar public key', () => {
    expect(StrKey.isValidEd25519PublicKey(PROBE_ACCOUNT)).toBe(true);
  });
});

describe('anchor-survey: checkSep10Liveness', () => {
  it('marks a MoneyGram-style endpoint alive and never issues a bare GET', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const hasAccount = new URL(url).searchParams.has('account');
      return new Response(null, { status: hasAccount ? 400 : 500 });
    });
    const result = await checkSep10Liveness(MONEYGRAM_AUTH, { fetchImpl });
    expect(result).toEqual({ url: MONEYGRAM_AUTH, status: 400, alive: true });
    expect(fetchImpl).toHaveBeenCalled();
    for (const [url] of fetchImpl.mock.calls) {
      expect(new URL(url).searchParams.get('account')).toBe(PROBE_ACCOUNT);
    }
  });

  it('marks a 5xx response with account as not alive', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 502 }));
    const result = await checkSep10Liveness(MONEYGRAM_AUTH, { fetchImpl });
    expect(result.status).toBe(502);
    expect(result.alive).toBe(false);
  });

  it('marks a network failure as not alive', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    });
    const result = await checkSep10Liveness(MONEYGRAM_AUTH, { fetchImpl });
    expect(result.alive).toBe(false);
    expect(result.error).toBe('TypeError:ENOTFOUND');
  });

  it('appends &account= when the URL already has a query', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 400 }));
    await checkSep10Liveness('https://a.example/auth?v=1', { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://a.example/auth?v=1&account=${PROBE_ACCOUNT}`);
  });
});
