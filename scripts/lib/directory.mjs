const DIRECTORY_URL = 'https://api.stellar.expert/explorer/public/directory?tag[]=anchor&limit=200';
const DIRECTORY_BASE = 'https://api.stellar.expert';
const DIRECTORY_ALL_URL = `${DIRECTORY_BASE}/explorer/public/directory?limit=200`;
const USER_AGENT = 'stellar-intel-anchor-survey/1.0';

/**
 * Fetch the anchor-tagged directory entries and return the candidate set.
 *
 * Each candidate is shaped as { domain, name, address } so it can be reused by
 * the survey and future onboarding triage scripts.
 */
export async function fetchDirectoryCandidates() {
  const res = await fetch(DIRECTORY_URL, {
    headers: { 'User-Agent': 'stellar-intel-anchor-survey/1.0' },
  });
  if (!res.ok) throw new Error(`directory fetch failed: HTTP ${res.status}`);

  const body = await res.json();
  const records = body?._embedded?.records ?? [];
  const seen = new Set();
  const candidates = [];

  for (const record of records) {
    const domain = record?.domain;
    const name = record?.name;
    const address = record?.address;

    if (!domain || !name || !address) continue;

    const key = domain;
    if (seen.has(key)) continue;

    seen.add(key);
    candidates.push({ domain, name, address });
  }

  return candidates.sort((a, b) => a.domain.localeCompare(b.domain));
}

/**
 * Page through the WHOLE public directory (no tag filter) and return the
 * deduped-by-domain candidate set.
 *
 * stellar.expert's `tag[]=anchor` listing misses anchors that never carry the
 * tag (several fiat anchors the 2026-09 census surfaced), so the survey reads
 * the unfiltered directory instead. Paging follows `_links.next.href`; the
 * first page failing is fatal, a later page failing just stops the walk (with
 * a warning) so a transient error cannot discard what was already collected.
 *
 * @param {{ maxPages?: number, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ domain: string, name?: string, address?: string, tags: string[] }[]>}
 *   Deduped by domain (first record wins), sorted by domain. Records without a
 *   `domain` are skipped; `tags` defaults to `[]`.
 */
export async function fetchDirectoryAll({ maxPages = 50, fetchImpl = fetch } = {}) {
  const seen = new Map();
  let next = DIRECTORY_ALL_URL;

  for (let page = 1; next && page <= maxPages; page++) {
    const res = await fetchImpl(next, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) {
      if (page === 1) throw new Error(`directory fetch failed: HTTP ${res.status}`);
      console.warn(
        `fetchDirectoryAll: HTTP ${res.status} on page ${page}; ` +
          `returning the ${seen.size} entries collected so far`
      );
      break;
    }

    const body = await res.json();
    const records = body?._embedded?.records ?? [];
    for (const record of records) {
      const domain = record?.domain;
      if (!domain || seen.has(domain)) continue;
      seen.set(domain, {
        domain,
        name: record?.name,
        address: record?.address,
        tags: record?.tags ?? [],
      });
    }

    if (records.length === 0) break;
    const href = body?._links?.next?.href;
    if (!href) break;
    next = new URL(href, DIRECTORY_BASE).toString();
  }

  return [...seen.values()].sort((a, b) => a.domain.localeCompare(b.domain));
}
