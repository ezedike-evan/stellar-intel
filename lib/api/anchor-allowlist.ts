import { ANCHORS } from '@/constants/anchors';

// SSRF allowlist for the server-side SEP-6 / SEP-12 proxies.
//
// The withdraw/customer routes fetch a caller-supplied `transferServer` URL from
// Node and forward the SEP-10 JWT to it. Without a host allowlist that is a
// credential-forwarding SSRF: any `https://` URL — including internal/link-local
// hosts (169.254.169.254, localhost, RFC-1918) — would be fetched with the user's
// bearer token attached. We constrain the destination to registered anchors.
//
// The allowlist is every `homeDomain`/`serviceDomain` in the anchor registry. A
// caller host is accepted only if it exactly equals, or is a subdomain of, one of
// those (anchors commonly host their transfer server on a subdomain, e.g.
// `stellar.mykobo.co` under `mykobo.co`).
const ALLOWED_ANCHOR_DOMAINS: readonly string[] = Array.from(
  new Set(
    ANCHORS.flatMap((a) => [a.homeDomain, a.serviceDomain]).filter(
      (d): d is string => typeof d === 'string' && d.length > 0
    )
  )
).map((d) => d.toLowerCase());

/** True when `hostname` is, or is a subdomain of, a registered anchor domain. */
export function isAllowedAnchorHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_ANCHOR_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Parse a caller-supplied transfer-server value and return it only if it is an
 * `https://` URL whose host is a registered anchor. Returns null otherwise —
 * callers must treat null as a 400 and never fetch the value.
 */
export function parseAllowedTransferServer(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (!isAllowedAnchorHost(url.hostname)) return null;
  return url;
}
