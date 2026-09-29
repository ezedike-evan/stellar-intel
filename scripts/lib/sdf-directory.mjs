// SDF Anchor Directory candidate source for the anchor survey (ANC046).
//
// The SDF Anchor Directory (anchors.stellar.org) lists operators by website
// and sometimes by stellar.toml URL. It surfaced anchors (APS, PeraHub,
// Bitnovo…) that no stellar.expert tag covers. The page embeds its data as
// JSON inside the HTML in both plain and backslash-escaped forms, e.g.
//   "website":"https://aps.money/"   and   \"website\":\"https://aps.money/\"
//
// Website hosts are candidates only — the survey's `classify` step decides
// whether a stellar.toml actually exists there.

const SDF_DIRECTORY_URL = 'https://anchors.stellar.org/';
const USER_AGENT = 'stellar-intel-anchor-survey/1.0';

// Matches the `website` / `toml_file` keys in the embedded JSON, tolerating
// the backslash-escaped variant, and captures the URL up to the closing quote
// or backslash (the escape that introduces it).
const HOST_FIELD_RE = /\\?"(website|toml_file)\\?":\\?"(https?:\/\/[^"\\]+)/g;

/**
 * Extract every `website` / `toml_file` hostname embedded in the SDF Anchor
 * Directory HTML. Hosts are lower-cased, a leading `www.` is stripped,
 * duplicates are removed and the result is sorted.
 *
 * @param {string} html
 * @returns {string[]}
 */
export function extractSdfDirectoryHosts(html) {
  const hosts = new Set();
  for (const match of html.matchAll(HOST_FIELD_RE)) {
    try {
      const host = new URL(match[2]).hostname.toLowerCase().replace(/^www\./, '');
      if (host) hosts.add(host);
    } catch {
      // Malformed URL in the page — ignore it rather than failing the source.
    }
  }
  return [...hosts].sort();
}

/**
 * Fetch the SDF Anchor Directory and return its hosts as survey candidates.
 * Throws on a non-200 so the caller can log + skip this source.
 *
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ domain: string, sources: string[] }[]>}
 */
export async function fetchSdfAnchorDirectoryDomains({ fetchImpl = fetch } = {}) {
  const res = await fetchImpl(SDF_DIRECTORY_URL, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`sdf anchor directory fetch failed: HTTP ${res.status}`);
  const html = await res.text();
  return extractSdfDirectoryHosts(html).map((domain) => ({
    domain,
    sources: ['sdf-anchor-directory'],
  }));
}
