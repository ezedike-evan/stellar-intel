import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import {
  PROBE_ACCOUNT,
  SURVEY_SOURCES,
  checkSep10Liveness,
  collectCandidates,
  buildCensus,
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

const DIRECTORY_URL = 'https://api.stellar.expert/explorer/public/directory?limit=200';
const ASSET_URL = 'https://api.stellar.expert/explorer/public/asset';
const SDF_URL = 'https://anchors.stellar.org/';

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

function htmlResponse(html) {
  return { ok: true, status: 200, json: async () => ({}), text: async () => html };
}

/**
 * Stub global fetch with one canned response per source. `overrides` may
 * replace a response with a function (called with the URL — may throw) or an
 * error to reject with.
 */
function stubSources(overrides = {}) {
  const respond = (url, fallback) => {
    const value = overrides[url] ?? fallback;
    if (value instanceof Error) throw value;
    if (typeof value === 'function') return value(url);
    return value;
  };

  return vi.fn(async (input) => {
    const url = String(input);
    if (url.startsWith(DIRECTORY_URL)) {
      return respond('directory', jsonResponse({ _embedded: { records: [] } }));
    }
    if (url.startsWith(ASSET_URL)) {
      return respond('assets', jsonResponse({ _embedded: { records: [] } }));
    }
    if (url.startsWith(SDF_URL)) {
      return respond('sdf', htmlResponse('<html></html>'));
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

const DIRECTORY_RECORDS = [
  { domain: 'shared.example', name: 'Shared', address: 'GASHARED' },
  { domain: 'onlydirectory.example', name: 'OnlyDir', address: 'GAONLYDIR' },
  { domain: 'localhost', name: 'Local', address: 'GALOCAL' },
  { domain: '1.2.3.4', name: 'IP', address: 'GAIP' },
  { domain: 'a b', name: 'Spaced', address: 'GASPACED' },
];

const ASSET_RECORDS = [
  { asset: 'SHARED-GDALPHA-1', code: 'SHARED', domain: 'shared.example' },
  { asset: 'ONLY-GDBETA-1', code: 'ONLY', domain: 'onlyassets.example' },
  { asset: 'NODOMAIN-GDGAMMA-1', code: 'NODOMAIN' },
];

const SDF_HTML = '<script>{"website":"https://sdfanchor.example/"}</script>';

describe('collectCandidates', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('merges overlapping domains across sources, recording every source', async () => {
    vi.stubGlobal(
      'fetch',
      stubSources({
        directory: jsonResponse({ _embedded: { records: DIRECTORY_RECORDS } }),
        assets: jsonResponse({ _embedded: { records: ASSET_RECORDS } }),
        sdf: htmlResponse(SDF_HTML),
      })
    );

    const { candidates, sources, failed } = await collectCandidates();

    expect(failed).toEqual([]);
    expect(sources).toEqual([...SURVEY_SOURCES]);

    const shared = candidates.find((c) => c.domain === 'shared.example');
    expect(shared.sources).toEqual(
      expect.arrayContaining(['stellar.expert-directory', 'stellar.expert-assets'])
    );
    expect(candidates.map((c) => c.domain)).toEqual(
      expect.arrayContaining(['onlydirectory.example', 'onlyassets.example', 'sdfanchor.example'])
    );
  });

  it('always includes the registry home and service domains', async () => {
    vi.stubGlobal('fetch', stubSources());

    const { candidates } = await collectCandidates();

    const registry = candidates.filter((c) => c.sources.includes('registry'));
    const domains = registry.map((c) => c.domain);
    // cowrie registers both a home domain and a distinct service subdomain.
    expect(domains).toEqual(expect.arrayContaining(['cowrie.exchange', 'api.cowrie.exchange']));
    expect(registry.every((c) => c.sources.length >= 1)).toBe(true);
  });

  it('drops invalid hostnames (localhost, bare IPs, malformed)', async () => {
    vi.stubGlobal(
      'fetch',
      stubSources({
        directory: jsonResponse({ _embedded: { records: DIRECTORY_RECORDS } }),
        assets: jsonResponse({ _embedded: { records: ASSET_RECORDS } }),
        sdf: htmlResponse(SDF_HTML),
      })
    );

    const { candidates } = await collectCandidates();
    const domains = candidates.map((c) => c.domain);

    expect(domains).not.toContain('localhost');
    expect(domains).not.toContain('1.2.3.4');
    expect(domains).not.toContain('a b');
    expect(domains).toContain('shared.example');
  });

  it('skips a source that throws and runs the rest, warning about it', async () => {
    vi.stubGlobal(
      'fetch',
      stubSources({
        directory: jsonResponse({ _embedded: { records: DIRECTORY_RECORDS } }),
        assets: jsonResponse({ _embedded: { records: ASSET_RECORDS } }),
        sdf: new Error('sdf is down'),
      })
    );

    const { candidates, sources, failed } = await collectCandidates();

    expect(failed).toEqual(['sdf-anchor-directory']);
    expect(sources).toEqual(['registry', 'stellar.expert-directory', 'stellar.expert-assets']);
    expect(candidates.map((c) => c.domain)).toEqual(
      expect.arrayContaining(['onlydirectory.example', 'onlyassets.example', 'cowrie.exchange'])
    );
    expect(candidates.some((c) => c.sources.includes('sdf-anchor-directory'))).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('source sdf-anchor-directory failed')
    );
  });

  it('throws when every remote source fails so the survey can exit 1', async () => {
    vi.stubGlobal(
      'fetch',
      stubSources({
        directory: new Error('directory down'),
        assets: new Error('assets down'),
        sdf: new Error('sdf down'),
      })
    );

    // fetchTopAssetDomains swallows its own per-sort failures (#1732), so it
    // never throws; the throwing remote sources are the directory and SDF.
    await expect(
      collectCandidates({
        sources: ['registry', 'stellar.expert-directory', 'sdf-anchor-directory'],
      })
    ).rejects.toThrow(/all remote candidate sources failed/);
    const warned = console.warn.mock.calls.flat().map(String).join('\n');
    expect(warned).toContain('source stellar.expert-directory failed');
    expect(warned).toContain('source sdf-anchor-directory failed');
  });

  it('limits the run to the requested sources', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { candidates, sources } = await collectCandidates({ sources: ['registry'] });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sources).toEqual(['registry']);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.sources.includes('registry'))).toBe(true);
  });

  it('accepts a comma-separated --sources value and ignores unknown names', async () => {
    vi.stubGlobal('fetch', stubSources());

    const { sources } = await collectCandidates({
      sources: 'registry, sdf-anchor-directory, bogus',
    });

    expect(sources).toEqual(['registry', 'sdf-anchor-directory']);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('unknown source(s) ignored: bogus')
    );
  });
});

const GENERATED_AT = '2026-09-27T00:00:00.000Z';

const REGISTRY = [
  { id: 'cowrie', homeDomain: 'cowrie.exchange', serviceDomain: 'api.cowrie.exchange' },
];

const RESULTS = [
  {
    domain: 'api.cowrie.exchange',
    reachable: true,
    sep6: true,
    sep24: false,
    sep31: false,
    sep38: false,
    sep10: true,
    rails: { sep6: { ok: true, withdraw: ['USDC'] } },
    withdrawAssets: ['USDC'],
    depositAssets: [],
    receiveAssets: [],
    sources: ['https://api.stellar.expert/explorer/public/directory?tag[]=anchor&limit=200'],
    checkedAt: GENERATED_AT,
  },
  {
    domain: 'healthonly.example',
    reachable: true,
    sep6: false,
    sep24: false,
    sep31: true,
    sep38: false,
    sep10: false,
    withdrawAssets: [],
    depositAssets: [],
    receiveAssets: ['USDC'],
    sources: ['https://api.stellar.expert/explorer/public/directory?tag[]=anchor&limit=200'],
    checkedAt: GENERATED_AT,
  },
  {
    domain: 'listed.example',
    reachable: true,
    sep6: false,
    sep24: false,
    sep31: false,
    sep38: false,
    sep10: false,
    withdrawAssets: [],
    depositAssets: [],
    receiveAssets: [],
    sources: ['https://api.stellar.expert/explorer/public/directory?tag[]=anchor&limit=200'],
    checkedAt: GENERATED_AT,
  },
  {
    domain: 'fake.example',
    reachable: true,
    sep6: true,
    excluded: 'impersonation',
  },
  {
    domain: 'dead.example',
    reachable: false,
    reason: 'HTTP 404',
    checkedAt: GENERATED_AT,
  },
];

describe('anchor-survey: buildCensus', () => {
  it('produces one row per non-excluded result, only counting excluded ones', () => {
    const census = buildCensus(RESULTS, REGISTRY, GENERATED_AT);

    expect(census.generatedAt).toBe(GENERATED_AT);
    expect(census.rows).toHaveLength(4);
    expect(census.counts).toEqual({ routable: 1, healthOnly: 1, listed: 2, excluded: 1 });
  });

  it('sorts rows by tier then domain', () => {
    const census = buildCensus(RESULTS, REGISTRY, GENERATED_AT);
    expect(census.rows.map((r) => r.tier)).toEqual(['routable', 'health-only', 'listed', 'listed']);
    expect(census.rows.map((r) => r.domain)).toEqual([
      'api.cowrie.exchange',
      'healthonly.example',
      'dead.example',
      'listed.example',
    ]);
  });

  it('matches registeredAnchorId on home or service domain', () => {
    const census = buildCensus(RESULTS, REGISTRY, GENERATED_AT);
    const cowrie = census.rows.find((r) => r.domain === 'api.cowrie.exchange');
    const healthOnly = census.rows.find((r) => r.domain === 'healthonly.example');

    expect(cowrie.registeredAnchorId).toBe('cowrie');
    expect(healthOnly.registeredAnchorId).toBeNull();
  });

  it('carries the seps and asset fields through for each row', () => {
    const census = buildCensus(RESULTS, REGISTRY, GENERATED_AT);
    const cowrie = census.rows.find((r) => r.domain === 'api.cowrie.exchange');

    expect(cowrie.seps).toEqual({
      sep6: true,
      sep24: false,
      sep31: false,
      sep38: false,
      sep10: true,
    });
    expect(cowrie.withdrawAssets).toEqual(['USDC']);
  });

  it('defaults missing asset/source fields to empty arrays', () => {
    const census = buildCensus(
      [{ domain: 'bare.example', reachable: true, sep6: false }],
      [],
      GENERATED_AT
    );
    const [row] = census.rows;
    expect(row.withdrawAssets).toEqual([]);
    expect(row.depositAssets).toEqual([]);
    expect(row.receiveAssets).toEqual([]);
    expect(row.sources).toEqual([]);
  });
});
