import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTopAssetDomains } from '../scripts/lib/asset-seeds.mjs';

const page = (records, next) => ({
  status: 200,
  json: async () => ({
    _embedded: { records },
    _links: next ? { next: { href: next } } : {},
  }),
});

const rec = (code, domain) => ({ asset: `${code}-G-1`, code, domain });

/** Route stubbed responses by the `sort=` query parameter. */
function stubBySort(bySort) {
  return vi.fn(async (url) => {
    const sort = new URL(url).searchParams.get('sort');
    const handler = bySort[sort];
    if (!handler) throw new Error(`unexpected sort ${sort}`);
    return handler(url);
  });
}

afterEach(() => vi.restoreAllMocks());

describe('fetchTopAssetDomains', () => {
  it('merges two sorts that overlap on one domain into one row with both sources', async () => {
    const fetchImpl = stubBySort({
      rating: () => page([rec('ARST', 'latamex.com'), rec('YUSDC', 'ultracapital.xyz')]),
      trustlines: () => page([rec('ARST', 'Latamex.com'), rec('DZT', 'dzt.example')]),
    });

    const rows = await fetchTopAssetDomains({ sorts: ['rating', 'trustlines'], fetchImpl });

    expect(rows).toEqual([
      { domain: 'dzt.example', sources: ['top-assets:trustlines'] },
      { domain: 'latamex.com', sources: ['top-assets:rating', 'top-assets:trustlines'] },
      { domain: 'ultracapital.xyz', sources: ['top-assets:rating'] },
    ]);
  });

  it('skips records without a domain and the native XLM record', async () => {
    const fetchImpl = stubBySort({
      rating: () =>
        page([
          { asset: 'XLM', code: 'XLM', domain: 'stellar.org' },
          { asset: 'NODOM-G-1', code: 'NODOM' },
          { asset: 'EMPTY-G-1', code: 'EMPTY', domain: '' },
          rec('OK', 'ok.example'),
        ]),
    });

    const rows = await fetchTopAssetDomains({ sorts: ['rating'], fetchImpl });

    expect(rows).toEqual([{ domain: 'ok.example', sources: ['top-assets:rating'] }]);
  });

  it('follows _links.next.href with the API prefix and stops at perSort', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('cursor=2'))
        return page(
          [rec('C', 'c.example'), rec('D', 'd.example')],
          '/explorer/public/asset?cursor=3'
        );
      return page(
        [rec('A', 'a.example'), rec('B', 'b.example')],
        '/explorer/public/asset?sort=rating&cursor=2'
      );
    });

    const rows = await fetchTopAssetDomains({ sorts: ['rating'], perSort: 3, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toBe(
      'https://api.stellar.expert/explorer/public/asset?sort=rating&cursor=2'
    );
    expect(rows.map((r) => r.domain)).toEqual(['a.example', 'b.example', 'c.example']);
  });

  it('stops paging when a page is empty', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(page([rec('A', 'a.example')], '/explorer/public/asset?cursor=2'))
      .mockResolvedValueOnce(page([], '/explorer/public/asset?cursor=3'));

    const rows = await fetchTopAssetDomains({ sorts: ['rating'], fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(1);
  });

  it('warns and continues when one sort returns a non-200', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = stubBySort({
      rating: () => ({ status: 503, json: async () => ({}) }),
      payments: () => page([rec('A', 'a.example')]),
    });

    const rows = await fetchTopAssetDomains({ sorts: ['rating', 'payments'], fetchImpl });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([{ domain: 'a.example', sources: ['top-assets:payments'] }]);
  });
});
