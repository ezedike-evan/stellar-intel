const SDF_DIRECTORY_URL = 'https://anchors.stellar.org/';

// The directory page embeds its data as JSON inside the HTML, both plain
// ("website":"https://…") and backslash-escaped (\"website\":\"https://…\").
const URL_FIELD_RE = /\\?"(website|toml_file)\\?":\\?"(https?:\/\/[^"\\]+)/g;

/**
 * Extract the distinct hostnames referenced by `website` and `toml_file`
 * fields in the SDF Anchor Directory HTML.
 *
 * Hosts are lower-cased, stripped of a leading `www.`, deduped and sorted.
 * Null fields (`"website":null`) never match and are ignored.
 *
 * @param {string} html
 * @returns {string[]}
 */
export function extractSdfDirectoryHosts(html) {
  const hosts = new Set();

  for (const match of html.matchAll(URL_FIELD_RE)) {
    let hostname;
    try {
      hostname = new URL(match[2]).hostname;
    } catch {
      continue;
    }
    const host = hostname.toLowerCase().replace(/^www\./, '');
    if (host) hosts.add(host);
  }

  return [...hosts].sort();
}

/**
 * Fetch the SDF Anchor Directory and return its hosts as survey candidates.
 *
 * Website hosts are candidates only: classify decides whether a stellar.toml
 * actually exists there.
 */
export async function fetchSdfAnchorDirectoryDomains({ fetchImpl = fetch } = {}) {
  const res = await fetchImpl(SDF_DIRECTORY_URL, {
    headers: { 'User-Agent': 'stellar-intel-anchor-survey/1.0' },
  });
  if (res.status !== 200) throw new Error(`SDF anchor directory fetch failed: HTTP ${res.status}`);

  const body = await res.text();
  return extractSdfDirectoryHosts(body).map((d) => ({
    domain: d,
    sources: ['sdf-anchor-directory'],
  }));
}
