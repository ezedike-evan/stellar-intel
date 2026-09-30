const API_ORIGIN = 'https://api.stellar.expert';
const PAGE_LIMIT = 200;
const DEFAULT_SORTS = ['rating', 'volume7d', 'trustlines', 'payments'];

/** The native XLM record has no issuer and no home domain worth probing. */
function isNative(record) {
  return record?.asset === 'XLM' || (record?.code === 'XLM' && !record?.issuer);
}

function absoluteUrl(href) {
  return /^https?:\/\//i.test(href) ? href : `${API_ORIGIN}${href}`;
}

/**
 * Read up to `perSort` asset records for one sort, following `_links.next.href`.
 * Stops early when a page is empty or has no next link. Throws on a non-200.
 */
async function fetchSortRecords(sort, perSort, fetchImpl) {
  const records = [];
  let url = `${API_ORIGIN}/explorer/public/asset?sort=${sort}&order=desc&limit=${PAGE_LIMIT}`;

  while (url && records.length < perSort) {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': 'stellar-intel-anchor-survey/1.0' },
    });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);

    const body = await res.json();
    const page = body?._embedded?.records ?? [];
    if (page.length === 0) break;

    records.push(...page);
    const next = body?._links?.next?.href;
    url = next ? absoluteUrl(next) : null;
  }

  return records.slice(0, perSort);
}

/**
 * Collect the home domains of the most-held / most-traded Stellar assets as
 * anchor survey candidates. Issuers of widely used assets often run anchors
 * that no directory tags, and the domain is on every asset record.
 *
 * A sort that fails (non-200 or network error) is logged and skipped so the
 * remaining sorts still contribute.
 *
 * @returns {Promise<Array<{ domain: string, sources: string[] }>>} one row per
 *   lower-cased domain, sorted by domain, with a `top-assets:<sort>` source for
 *   every sort that listed it.
 */
export async function fetchTopAssetDomains({
  sorts = DEFAULT_SORTS,
  perSort = 600,
  fetchImpl = fetch,
} = {}) {
  const byDomain = new Map();

  for (const sort of sorts) {
    let records;
    try {
      records = await fetchSortRecords(sort, perSort, fetchImpl);
    } catch (err) {
      console.warn(`asset seeds: sort "${sort}" failed (${err?.message ?? err}); skipping`);
      continue;
    }

    for (const record of records) {
      if (isNative(record)) continue;
      const domain = typeof record?.domain === 'string' ? record.domain.trim().toLowerCase() : '';
      if (!domain) continue;

      const source = `top-assets:${sort}`;
      const sources = byDomain.get(domain) ?? [];
      if (!sources.includes(source)) sources.push(source);
      byDomain.set(domain, sources);
    }
  }

  return [...byDomain.entries()]
    .map(([domain, sources]) => ({ domain, sources }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
}
