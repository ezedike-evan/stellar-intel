import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTopAssetDomains } from '../scripts/lib/asset-seeds.mjs';

const ASSET_URL = 'https://api.stellar.expert/explorer/public/asset';

function page(records, nextHref) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      _embedded: { records },
      ...(nextHref ? { _links: { next: { href: nextHref } } } : {}),
    }),
  };
}

/** Build a fetch mock keyed by `sort=<sort>` in the query string. */
function stubSorts(bySort) {
  return vi.fn(async (input) => {
    const url = new URL(String(input));
    const sort = url.searchParams.get('sort');
    const response = bySort[sort];
    if (!response) throw new Error(`unexpected fetch: ${url}`);
    return response instanceof Error ? Promise.reject(response) : response;
  });
}

describe('fetchTopAssetDomains', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('merges overlapping domains across sorts into one row with both sources', async () => {
    vi.stubGlobal(
      'fetch',
      stubSorts({
        rating: page([
          { asset: 'SHARED-GD1-1', code: 'SHARED', domain: 'Shared.Example' },
          { asset: 'ONLY-GD2-1', code: 'ONLY', domain: 'ratingonly.example' },
        ]),
        volume7d: page([{ asset: 'SHARED-GD1-1', code: 'SHARED', domain: 'shared.example' }]),
      })
    );

    const domains = await fetchTopAssetDomains({ sorts: ['rating', 'volume7d'] });

    const shared = domains.find((d) => d.domain === 'shared.example');
    expect(shared.sources).toEqual(['top-assets:rating', 'top-assets:volume7d']);
    expect(domains.map((d) => d.domain)).toEqual(['ratingonly.example', 'shared.example']);
  });

  it('skips records without a domain and the native XLM record', async () => {
    vi.stubGlobal(
      'fetch',
      stubSorts({
        rating: page([
          { asset: 'XLM', code: 'XLM' },
          { asset: 'NODOMAIN-GD1-1', code: 'NODOMAIN' },
          { asset: 'KEEP-GD2-1', code: 'KEEP', domain: 'keep.example' },
        ]),
      })
    );

    const domains = await fetchTopAssetDomains({ sorts: ['rating'] });

    expect(domains).toEqual([{ domain: 'keep.example', sources: ['top-assets:rating'] }]);
  });

  it('caps paging at perSort records', async () => {
    const page1 = page(
      [
        { asset: 'A-GD1-1', code: 'A', domain: 'a.example' },
        { asset: 'B-GD2-1', code: 'B', domain: 'b.example' },
      ],
      '/explorer/public/asset?sort=rating&order=desc&limit=200&cursor=2'
    );
    const fetchMock = vi.fn(async () => page1);
    vi.stubGlobal('fetch', fetchMock);

    const domains = await fetchTopAssetDomains({ sorts: ['rating'], perSort: 2 });

    // perSort reached on the first page — the next page is never requested.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(domains.map((d) => d.domain)).toEqual(['a.example', 'b.example']);
  });

  it('warns about a failing sort and still returns the others', async () => {
    vi.stubGlobal(
      'fetch',
      stubSorts({
        rating: new Error('HTTP 500'),
        volume7d: page([{ asset: 'KEEP-GD1-1', code: 'KEEP', domain: 'keep.example' }]),
      })
    );

    const domains = await fetchTopAssetDomains({ sorts: ['rating', 'volume7d'] });

    expect(domains).toEqual([{ domain: 'keep.example', sources: ['top-assets:volume7d'] }]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('sort rating failed: HTTP 500')
    );
  });

  it('throws when every sort failed, so down is distinguishable from empty', async () => {
    vi.stubGlobal(
      'fetch',
      stubSorts({
        rating: new Error('HTTP 500'),
        volume7d: new Error('HTTP 502'),
      })
    );

    await expect(fetchTopAssetDomains({ sorts: ['rating', 'volume7d'] })).rejects.toThrow(
      /all sorts failed/
    );
  });

  it('lower-cases and dedupes domains within a sort', async () => {
    vi.stubGlobal(
      'fetch',
      stubSorts({
        rating: page([
          { asset: 'A-GD1-1', code: 'A', domain: 'Dupe.Example' },
          { asset: 'B-GD2-1', code: 'B', domain: 'dupe.example' },
        ]),
      })
    );

    const domains = await fetchTopAssetDomains({ sorts: ['rating'] });

    expect(domains).toEqual([{ domain: 'dupe.example', sources: ['top-assets:rating'] }]);
  });
});
