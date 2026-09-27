const BLOCKED_HOSTNAME_SUFFIXES = ['.localhost', '.local', '.internal'];

function isIpv4PrivateOrReserved(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;

  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;

  const [a, b, c, d] = octets as [number, number, number, number];
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  if (a === 0 && b === 0 && c === 0 && d === 0) return true; // 0.0.0.0

  return false;
}

function isIpv6PrivateOrReserved(host: string): boolean {
  // Hostname from the URL parser retains brackets for IPv6 literals.
  const stripped = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (stripped === '::1') return true;

  // fc00::/7 covers unique local addresses, i.e. hostnames starting with fc or fd.
  const firstGroup = stripped.split(':')[0] ?? '';
  if (/^f[cd]/.test(firstGroup)) return true;

  return false;
}

/**
 * Guards webhook subscription targets against SSRF: only public https
 * endpoints are allowed, so an admin-set URL can never reach localhost or an
 * internal network address at delivery time.
 */
export function isPublicHttpsUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;

  const hostname = parsed.hostname.toLowerCase();

  if (hostname === 'localhost') return false;
  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return false;

  if (isIpv4PrivateOrReserved(hostname)) return false;
  if (hostname.startsWith('[') || hostname.includes(':')) {
    if (isIpv6PrivateOrReserved(hostname)) return false;
  }

  return true;
}
