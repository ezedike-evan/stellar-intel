import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectCandidates, SURVEY_SOURCES } from '../scripts/anchor-survey.mjs';

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

    await expect(collectCandidates()).rejects.toThrow(/all remote candidate sources failed/);
    const warned = console.warn.mock.calls.flat().map(String).join('\n');
    expect(warned).toContain('source stellar.expert-directory failed');
    expect(warned).toContain('source stellar.expert-assets failed');
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
