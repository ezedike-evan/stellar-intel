const DIRECTORY_URL = 'https://api.stellar.expert/explorer/public/directory?tag[]=anchor&limit=200';
const DIRECTORY_ALL_URL = 'https://api.stellar.expert/explorer/public/directory?limit=200';
const STELLAR_EXPERT_ORIGIN = 'https://api.stellar.expert';

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
 * Page through the whole stellar.expert directory without filtering by tag,
 * following `_links.next.href` until empty or `maxPages` is reached.
 *
 * Returns records deduped by domain and sorted by domain name.
 */
export async function fetchDirectoryAll({ maxPages = 50, fetchImpl = fetch } = {}) {
  let nextUrl = DIRECTORY_ALL_URL;
  let pageCount = 0;
  const seen = new Set();
  const candidates = [];

  while (nextUrl && pageCount < maxPages) {
    pageCount++;
    let res;
    try {
      res = await fetchImpl(nextUrl, {
        headers: { 'User-Agent': 'stellar-intel-anchor-survey/1.0' },
      });
    } catch (err) {
      if (pageCount === 1) {
        throw err;
      }
      console.warn(
        `directory page fetch failed: ${err instanceof Error ? err.message : String(err)}`
      );
      break;
    }

    if (!res.ok) {
      if (pageCount === 1) {
        throw new Error(`directory fetch failed: HTTP ${res.status}`);
      }
      console.warn(`directory page fetch failed: HTTP ${res.status}`);
      break;
    }

    let body;
    try {
      body = await res.json();
    } catch (err) {
      if (pageCount === 1) {
        throw err;
      }
      console.warn(
        `directory page JSON parse failed: ${err instanceof Error ? err.message : String(err)}`
      );
      break;
    }

    const records = body?._embedded?.records ?? [];
    if (records.length === 0) {
      break;
    }

    for (const record of records) {
      const domain = record?.domain;
      if (!domain) continue;

      if (seen.has(domain)) continue;
      seen.add(domain);

      const name = record?.name;
      const address = record?.address;
      const tags = Array.isArray(record?.tags) ? record.tags : [];

      candidates.push({ domain, name, address, tags });
    }

    const nextHref = body?._links?.next?.href;
    if (nextHref) {
      nextUrl = new URL(nextHref, STELLAR_EXPERT_ORIGIN).href;
    } else {
      nextUrl = null;
    }
  }

  return candidates.sort((a, b) => a.domain.localeCompare(b.domain));
}
