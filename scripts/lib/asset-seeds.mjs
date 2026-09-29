// stellar.expert asset-listing seeds for the anchor survey (ANC045).
//
// Issuers of widely held assets (ARST, DZT, CLPX…) run anchors that no
// directory tag covers, but their home domain is on every asset record. The
// most-rated / most-traded / most-trusted / most-used assets are therefore a
// strong candidate source for domains the `tag[]=anchor` listing never shows.
//
// Each domain carries the sort(s) it was found under (`top-assets:<sort>`) so
// the survey output records where every candidate came from.

const ASSET_BASE = 'https://api.stellar.expert/explorer/public/asset';
const DIRECTORY_BASE = 'https://api.stellar.expert';
const USER_AGENT = 'stellar-intel-anchor-survey/1.0';
const DEFAULT_SORTS = ['rating', 'volume7d', 'trustlines', 'payments'];

/**
 * Collect candidate home domains from the top of each stellar.expert asset
 * ranking. Paging follows `_links.next.href` up to `perSort` records per sort;
 * a failing sort logs a warning and the next sort still runs, so one bad
 * response can't drop the whole source. Throws when EVERY sort failed — the
 * caller then knows the source was down rather than simply empty.
 *
 * @param {{
 *   sorts?: string[],
 *   perSort?: number,
 *   fetchImpl?: typeof fetch,
 * }} [opts]
 * @returns {Promise<{ domain: string, sources: string[] }[]>}
 *   Domains lower-cased and deduped (first sort in `sorts` order wins the
 *   position), each carrying every `top-assets:<sort>` it appeared under.
 *   Records without a `domain` and the native XLM record are skipped.
 */
export async function fetchTopAssetDomains({
  sorts = DEFAULT_SORTS,
  perSort = 600,
  fetchImpl = fetch,
} = {}) {
  /** @type {Map<string, { domain: string, sources: string[] }>} */
  const merged = new Map();
  let completedSorts = 0;

  for (const sort of sorts) {
    let url = `${ASSET_BASE}?sort=${sort}&order=desc&limit=200`;
    let read = 0;
    try {
      while (url && read < perSort) {
        const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const body = await res.json();
        const records = body?._embedded?.records ?? [];
        for (const record of records) {
          if (read >= perSort) break;
          read++;

          const domain = record?.domain;
          if (!domain) continue;
          if (record?.asset === 'XLM' || record?.code === 'XLM') continue;

          const key = domain.toLowerCase();
          const source = `top-assets:${sort}`;
          const entry = merged.get(key);
          if (entry) {
            if (!entry.sources.includes(source)) entry.sources.push(source);
            continue;
          }
          merged.set(key, { domain: key, sources: [source] });
        }

        if (records.length === 0) break;
        const href = body?._links?.next?.href;
        if (!href) break;
        url = new URL(href, DIRECTORY_BASE).toString();
      }
    } catch (err) {
      console.warn(`fetchTopAssetDomains: sort ${sort} failed: ${err?.message ?? err}`);
      continue;
    }
    completedSorts++;
  }

  // Every sort failing means the source is down, not that the fleet is empty —
  // throw so the survey can tell "source failed" apart from "no results".
  if (completedSorts === 0) {
    throw new Error(`fetchTopAssetDomains: all sorts failed (${sorts.join(', ')})`);
  }

  return [...merged.values()].sort((a, b) => a.domain.localeCompare(b.domain));
}
