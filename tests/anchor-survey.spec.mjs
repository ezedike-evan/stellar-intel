import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classify,
  parseTomlEndpoints,
  summarizeSep31Info,
  summarizeSep38Info,
  summarizeTransferInfo,
  tierOf,
} from '../scripts/anchor-survey.mjs';

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

function tomlResponse(toml) {
  return {
    ok: true,
    status: 200,
    text: async () => toml,
    json: async () => JSON.parse(toml),
  };
}

function infoResponse(json) {
  return {
    ok: true,
    status: 200,
    json: async () => json,
    text: async () => JSON.stringify(json),
  };
}

function httpError(status = 500) {
  return { ok: false, status, text: async () => '', json: async () => ({}) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parseTomlEndpoints', () => {
  it('extracts https URLs from quoted values', () => {
    const toml = `
TRANSFER_SERVER = "https://sep6.example.com"
TRANSFER_SERVER_SEP0024 = 'https://sep24.example.com/'
DIRECT_PAYMENT_SERVER = "https://sep31.example.com/sep31"
ANCHOR_QUOTE_SERVER = "https://quotes.example.com"
WEB_AUTH_ENDPOINT = "https://auth.example.com"
KYC_SERVER = "https://kyc.example.com"
`;
    expect(parseTomlEndpoints(toml)).toEqual({
      sep6: 'https://sep6.example.com',
      sep24: 'https://sep24.example.com/',
      sep31: 'https://sep31.example.com/sep31',
      sep38: 'https://quotes.example.com',
      sep10: 'https://auth.example.com',
      sep12: 'https://kyc.example.com',
    });
  });

  it('returns null for missing keys and non-https URLs', () => {
    const toml = `
TRANSFER_SERVER = "http://insecure.example.com"
TRANSFER_SERVER_SEP0024 = "/relative/path"
`;
    const parsed = parseTomlEndpoints(toml);
    expect(parsed.sep6).toBeNull();
    expect(parsed.sep24).toBeNull();
    expect(parsed.sep31).toBeNull();
    expect(parsed.sep38).toBeNull();
    expect(parsed.sep10).toBeNull();
    expect(parsed.sep12).toBeNull();
  });
});

describe('summarizeTransferInfo', () => {
  it('latamex-like: withdraw ARST/BRLT enabled, withdraw-exchange USDC enabled, USDC withdraw disabled', () => {
    const json = {
      deposit: {
        ARST: { enabled: true },
      },
      withdraw: {
        ARST: { enabled: true },
        BRLT: { enabled: true },
        USDC: { enabled: false },
      },
      'withdraw-exchange': {
        USDC: { enabled: true },
      },
    };
    const summary = summarizeTransferInfo(json);
    expect(summary.withdraw).toEqual(expect.arrayContaining(['ARST', 'BRLT']));
    expect(summary.withdraw).not.toContain('USDC');
    expect(summary.withdrawExchange).toEqual(['USDC']);
  });

  it('ntokens-like: empty deposit, withdraw BRL types map', () => {
    const json = {
      deposit: {},
      withdraw: {
        BRL: {
          enabled: true,
          types: {
            orange_mm: {},
            bank_account: {},
            mts_mm: {},
          },
        },
      },
    };
    const summary = summarizeTransferInfo(json);
    expect(summary.deposit).toEqual([]);
    expect(summary.withdraw).toEqual(['BRL']);
    expect(summary.withdrawTypes.BRL).toEqual(['bank_account', 'mts_mm', 'orange_mm']);
  });
});

describe('summarizeSep31Info / summarizeSep38Info', () => {
  it('sep31 receive map keeps codes with enabled !== false', () => {
    const summary = summarizeSep31Info({
      receive: {
        USDC: { enabled: true },
        BRL: {},
        CLP: { enabled: false },
      },
    });
    expect(summary.receive).toEqual(expect.arrayContaining(['USDC', 'BRL']));
    expect(summary.receive).not.toContain('CLP');
  });

  it('sep38 assets lists asset strings', () => {
    const summary = summarizeSep38Info({
      assets: [{ asset: 'stellar:USDC:GA5Z' }, { asset: 'stellar:BRL:GBBD' }],
    });
    expect(summary.assets).toEqual(['stellar:USDC:GA5Z', 'stellar:BRL:GBBD']);
  });
});

describe('classify with /info', () => {
  it('attaches per-rail summaries and currencies, keeping boolean fields', async () => {
    const toml = `
TRANSFER_SERVER = "https://sep6.example.com"
TRANSFER_SERVER_SEP0024 = "https://sep24.example.com"
DIRECT_PAYMENT_SERVER = "https://sep31.example.com"
ANCHOR_QUOTE_SERVER = "https://sep38.example.com"
[[CURRENCIES]]
code = "USDC"
issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
`;
    const sep6Info = {
      withdraw: { ARST: { enabled: true }, BRLT: { enabled: true }, USDC: { enabled: false } },
      'withdraw-exchange': { USDC: { enabled: true } },
    };
    const sep24Info = { deposit: { USDC: { enabled: true } }, withdraw: {} };
    const sep31Info = { receive: { USDC: { enabled: true }, CLP: { enabled: false } } };
    const sep38Info = { assets: [{ asset: 'stellar:USDC:GA5Z' }] };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) => {
        const url = String(input);
        if (url.endsWith('/.well-known/stellar.toml')) return tomlResponse(toml);
        if (url === 'https://sep6.example.com/info') return infoResponse(sep6Info);
        if (url === 'https://sep24.example.com/info') return infoResponse(sep24Info);
        if (url === 'https://sep31.example.com/info') return infoResponse(sep31Info);
        if (url === 'https://sep38.example.com/info') return infoResponse(sep38Info);
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const result = await classify('survey.example');
    expect(result.reachable).toBe(true);
    expect(result.sep6).toBe(true);
    expect(result.sep24).toBe(true);
    expect(result.sep31).toBe(true);
    expect(result.sep38).toBe(true);
    expect(result.currencies).toEqual([
      {
        code: 'USDC',
        issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      },
    ]);
    expect(result.rails.sep6.ok).toBe(true);
    expect(result.rails.sep6.withdraw).toEqual(expect.arrayContaining(['ARST', 'BRLT']));
    expect(result.rails.sep6.withdrawExchange).toEqual(['USDC']);
    expect(result.rails.sep24.deposit).toEqual(['USDC']);
    expect(result.rails.sep31.receive).toEqual(['USDC']);
    expect(result.rails.sep38.assets).toEqual(['stellar:USDC:GA5Z']);
  });

  it('records a failing /info as ok:false', async () => {
    const toml = 'TRANSFER_SERVER = "https://down.example.com"\n';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) => {
        const url = String(input);
        if (url.endsWith('/.well-known/stellar.toml')) return tomlResponse(toml);
        if (url === 'https://down.example.com/info') return httpError(500);
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const result = await classify('down.example');
    expect(result.reachable).toBe(true);
    expect(result.rails.sep6.ok).toBe(false);
    expect(typeof result.rails.sep6.error).toBe('string');
  });
});
