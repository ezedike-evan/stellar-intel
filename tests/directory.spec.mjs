import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchDirectoryAll, fetchDirectoryCandidates } from '../scripts/lib/directory.mjs';

describe('fetchDirectoryCandidates', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the anchor-tagged candidate set from the directory API', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        _embedded: {
          records: [
            { domain: 'alpha.example', name: 'Alpha', address: 'GAALPHA' },
            { domain: 'beta.example', name: 'Beta', address: 'GABETA' },
            { domain: 'alpha.example', name: 'Alpha Dup', address: 'GAALPHA2' },
          ],
        },
      }),
    });

    const candidates = await fetchDirectoryCandidates();

    expect(candidates).toEqual([
      { domain: 'alpha.example', name: 'Alpha', address: 'GAALPHA' },
      { domain: 'beta.example', name: 'Beta', address: 'GABETA' },
    ]);
  });
});

describe('fetchDirectoryAll', () => {
  const PAGE_1 = 'https://api.stellar.expert/explorer/public/directory?limit=200';
  // The API hands back a path; it must be resolved against api.stellar.expert.
  const NEXT_HREF = '/explorer/public/directory?sort=address&order=asc&limit=200&cursor=abc';
  const PAGE_2 = `https://api.stellar.expert${NEXT_HREF}`;

  const page = (records, nextHref) => ({
    ok: true,
    status: 200,
    json: async () => ({
      _embedded: { records },
      ...(nextHref ? { _links: { next: { href: nextHref } } } : {}),
    }),
  });

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubPages(pages) {
    const fetchMock = vi.fn(async (input) => {
      const url = String(input);
      const response = pages[url];
      if (!response) throw new Error(`unexpected fetch: ${url}`);
      return response instanceof Error ? Promise.reject(response) : response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('pages until an empty page, merging, deduping and keeping tags', async () => {
    const fetchMock = stubPages({
      [PAGE_1]: page(
        [
          { domain: 'beta.example', name: 'Beta', address: 'GABETA', tags: ['anchor'] },
          { domain: 'alpha.example', name: 'Alpha', address: 'GAALPHA', tags: ['anchor'] },
        ],
        NEXT_HREF
      ),
      [PAGE_2]: page(
        [
          { domain: 'alpha.example', name: 'Alpha Dup', address: 'GAALPHA2' },
          { domain: 'gamma.example', name: 'Gamma', address: 'GAGAMMA', tags: ['fiat'] },
        ],
        NEXT_HREF.replace('cursor=abc', 'cursor=def')
      ),
      [PAGE_2.replace('cursor=abc', 'cursor=def')]: page([], null),
    });

    const candidates = await fetchDirectoryAll();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(candidates).toEqual([
      { domain: 'alpha.example', name: 'Alpha', address: 'GAALPHA', tags: ['anchor'] },
      { domain: 'beta.example', name: 'Beta', address: 'GABETA', tags: ['anchor'] },
      { domain: 'gamma.example', name: 'Gamma', address: 'GAGAMMA', tags: ['fiat'] },
    ]);
  });

  it('resolves next.href against https://api.stellar.expert', async () => {
    const fetchMock = stubPages({
      [PAGE_1]: page([{ domain: 'alpha.example', name: 'A', address: 'GA' }], NEXT_HREF),
      [PAGE_2]: page([], null),
    });

    await fetchDirectoryAll();

    expect(String(fetchMock.mock.calls[1][0])).toBe(PAGE_2);
  });

  it('stops at maxPages even when more pages are available', async () => {
    const fetchMock = stubPages({
      [PAGE_1]: page([{ domain: 'alpha.example', name: 'A', address: 'GA' }], NEXT_HREF),
      [PAGE_2]: page([{ domain: 'beta.example', name: 'B', address: 'GB' }], NEXT_HREF),
    });

    const candidates = await fetchDirectoryAll({ maxPages: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(candidates.map((c) => c.domain)).toEqual(['alpha.example', 'beta.example']);
  });

  it('returns page-1 results with a warning when a later page fails', async () => {
    stubPages({
      [PAGE_1]: page([{ domain: 'alpha.example', name: 'A', address: 'GA' }], NEXT_HREF),
      [PAGE_2]: { ok: false, status: 500, json: async () => ({}) },
    });

    const candidates = await fetchDirectoryAll();

    expect(candidates.map((c) => c.domain)).toEqual(['alpha.example']);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 500 on page 2'));
  });

  it('throws when the first page fails', async () => {
    stubPages({ [PAGE_1]: { ok: false, status: 404, json: async () => ({}) } });

    await expect(fetchDirectoryAll()).rejects.toThrow('directory fetch failed: HTTP 404');
  });
});
