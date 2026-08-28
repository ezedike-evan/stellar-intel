import { createHmac, timingSafeEqual } from 'crypto';

// Signature scheme (Stripe-style):
//   signed payload  = `${timestampSec}.${rawBody}`
//   signature       = HMAC-SHA256(secret, signed_payload) as lowercase hex
//   header value    = `t=${timestampSec},v1=${signature}`
//
// Consumers recompute the signature and compare using constant-time equality.
// The timestamp guards against replay: payloads older than toleranceSec are rejected.

export function buildSignatureHeader(
  secret: string,
  timestampSec: number,
  rawBody: string
): string {
  const payload = `${timestampSec}.${rawBody}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `t=${timestampSec},v1=${sig}`;
}

export function verifySignatureHeader(
  secret: string,
  header: string,
  rawBody: string,
  toleranceSec = 300
): boolean {
  const parts: Record<string, string> = {};
  for (const segment of header.split(',')) {
    const eq = segment.indexOf('=');
    if (eq === -1) continue;
    parts[segment.slice(0, eq)] = segment.slice(eq + 1);
  }

  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return false;

  const timestamp = parseInt(t, 10);
  if (Number.isNaN(timestamp)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSec) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
