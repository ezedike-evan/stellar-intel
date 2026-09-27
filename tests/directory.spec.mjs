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
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pages through results, merges, dedupes by domain, and keeps tags', async () => {
    const fetchMock = vi.fn();

    // Page 1
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        _embedded: {
          records: [
            { domain: 'zebra.example', name: 'Zebra', address: 'GAZEBRA', tags: ['anchor'] },
            {
              domain: 'alpha.example',
              name: 'Alpha',
              address: 'GAALPHA',
              tags: ['custody', 'defi'],
            },
            { name: 'No Domain', address: 'GANODOMAIN' }, // skipped
          ],
        },
        _links: {
          next: {
            href: '/explorer/public/directory?limit=200&cursor=p2',
          },
        },
      }),
    });

    // Page 2
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        _embedded: {
          records: [
            { domain: 'beta.example', name: 'Beta', address: 'GABETA' }, // no tags property -> default []
            { domain: 'alpha.example', name: 'Alpha Duplicate', address: 'GAALPHA_DUP' }, // deduped
          ],
        },
        _links: {
          next: {
            href: '/explorer/public/directory?limit=200&cursor=p3',
          },
        },
      }),
    });

    // Page 3 (empty page)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        _embedded: {
          records: [],
        },
      }),
    });

    const candidates = await fetchDirectoryAll({ fetchImpl: fetchMock });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.stellar.expert/explorer/public/directory?limit=200',
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.stellar.expert/explorer/public/directory?limit=200&cursor=p2',
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://api.stellar.expert/explorer/public/directory?limit=200&cursor=p3',
      expect.any(Object)
    );

    // Sorted by domain
    expect(candidates).toEqual([
      { domain: 'alpha.example', name: 'Alpha', address: 'GAALPHA', tags: ['custody', 'defi'] },
      { domain: 'beta.example', name: 'Beta', address: 'GABETA', tags: [] },
      { domain: 'zebra.example', name: 'Zebra', address: 'GAZEBRA', tags: ['anchor'] },
    ]);
  });

  it('respects maxPages limit', async () => {
    const fetchMock = vi.fn();

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        _embedded: {
          records: [{ domain: 'item.example', name: 'Item', address: 'GAITEM' }],
        },
        _links: {
          next: { href: '/explorer/public/directory?limit=200&cursor=next' },
        },
      }),
    });

    const candidates = await fetchDirectoryAll({ maxPages: 2, fetchImpl: fetchMock });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(candidates).toEqual([
      { domain: 'item.example', name: 'Item', address: 'GAITEM', tags: [] },
    ]);
  });

  it('throws on non-200 on the first page', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });

    await expect(fetchDirectoryAll({ fetchImpl: fetchMock })).rejects.toThrow(
      'directory fetch failed: HTTP 503'
    );
  });

  it('returns collected page-1 results when page 2 returns 500', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn();

    // Page 1 succeeds
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        _embedded: {
          records: [{ domain: 'first.example', name: 'First', address: 'GAFIRST' }],
        },
        _links: {
          next: { href: '/explorer/public/directory?limit=200&cursor=p2' },
        },
      }),
    });

    // Page 2 fails with 500
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const candidates = await fetchDirectoryAll({ fetchImpl: fetchMock });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith('directory page fetch failed: HTTP 500');
    expect(candidates).toEqual([
      { domain: 'first.example', name: 'First', address: 'GAFIRST', tags: [] },
    ]);

    warnSpy.mockRestore();
  });
});
