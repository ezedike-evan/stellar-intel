import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies an incoming webhook payload using the Stellar Intel signature scheme:
 *   signed payload = `${timestampSec}.${rawBody}`
 *   signature      = HMAC-SHA256(secret, signed payload) as lowercase hex
 *   header value   = `t=${timestampSec},v1=${signature}`
 *
 * @param {object} options
 * @param {string} options.secret - Webhook signing secret
 * @param {string} [options.signatureHeader] - Value of the x-webhook-signature header
 * @param {string|Buffer} options.rawBody - Raw request body before JSON parsing
 * @param {number} [options.nowSec] - Current timestamp in seconds (default: Date.now() / 1000)
 * @param {number} [options.toleranceSec] - Allowed drift in seconds (default: 300)
 * @returns {{ ok: true } | { ok: false, reason: 'missing_header' | 'malformed_header' | 'stale_timestamp' | 'bad_signature' }}
 */
export function verifyWebhook({
  secret,
  signatureHeader,
  rawBody,
  nowSec = Math.floor(Date.now() / 1000),
  toleranceSec = 300,
}) {
  if (!signatureHeader || typeof signatureHeader !== 'string' || signatureHeader.trim() === '') {
    return { ok: false, reason: 'missing_header' };
  }

  const parts = {};
  for (const segment of signatureHeader.split(',')) {
    const eq = segment.indexOf('=');
    if (eq === -1) continue;
    parts[segment.slice(0, eq).trim()] = segment.slice(eq + 1).trim();
  }

  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) {
    return { ok: false, reason: 'malformed_header' };
  }

  const timestamp = parseInt(t, 10);
  if (Number.isNaN(timestamp) || !/^\d+$/.test(t)) {
    return { ok: false, reason: 'malformed_header' };
  }

  if (Math.abs(nowSec - timestamp) > toleranceSec) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const bodyStr = typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody).toString('utf-8');
  const expected = createHmac('sha256', secret || '')
    .update(`${timestamp}.${bodyStr}`)
    .digest('hex');

  try {
    const v1Buf = Buffer.from(v1, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');

    // Prevent timingSafeEqual from throwing on length mismatch
    if (v1Buf.length !== expectedBuf.length || v1Buf.length === 0) {
      return { ok: false, reason: 'bad_signature' };
    }

    if (!timingSafeEqual(v1Buf, expectedBuf)) {
      return { ok: false, reason: 'bad_signature' };
    }

    return { ok: true };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
}
