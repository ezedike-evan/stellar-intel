const DIRECTORY_URL = 'https://api.stellar.expert/explorer/public/directory?tag[]=anchor&limit=200';

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
