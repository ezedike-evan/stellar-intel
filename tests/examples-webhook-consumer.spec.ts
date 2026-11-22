import { describe, it, expect } from 'vitest';
import { verifyWebhook } from '../examples/webhook-consumer/verify.mjs';
import { buildSignatureHeader } from '@/lib/webhooks/sign';

describe('Webhook Consumer Example — verifyWebhook (#2192)', () => {
  const secret = 'whsec_test_secret_1234567890abcdef';
  const body = JSON.stringify({ kind: 'dispute.filed', id: 'evt-123' });
  const now = 1763800000;

  it('valid gives ok', () => {
    const signatureHeader = buildSignatureHeader(secret, now, body);
    const result = verifyWebhook({
      secret,
      signatureHeader,
      rawBody: body,
      nowSec: now,
    });

    expect(result).toEqual({ ok: true });
  });

  it('a tampered body gives bad_signature', () => {
    const signatureHeader = buildSignatureHeader(secret, now, body);
    const tampered = JSON.stringify({ kind: 'dispute.filed', id: 'evt-456' });
    const result = verifyWebhook({
      secret,
      signatureHeader,
      rawBody: tampered,
      nowSec: now,
    });

    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('an old timestamp gives stale_timestamp', () => {
    const oldTimestamp = now - 400; // older than 300s tolerance
    const signatureHeader = buildSignatureHeader(secret, oldTimestamp, body);
    const result = verifyWebhook({
      secret,
      signatureHeader,
      rawBody: body,
      nowSec: now,
      toleranceSec: 300,
    });

    expect(result).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('an empty header gives missing_header', () => {
    const result = verifyWebhook({
      secret,
      signatureHeader: '',
      rawBody: body,
      nowSec: now,
    });

    expect(result).toEqual({ ok: false, reason: 'missing_header' });
  });

  it('t=abc,v1= gives malformed_header', () => {
    const result = verifyWebhook({
      secret,
      signatureHeader: 't=abc,v1=',
      rawBody: body,
      nowSec: now,
    });

    expect(result).toEqual({ ok: false, reason: 'malformed_header' });
  });

  it('a v1 of the wrong length gives bad_signature without throwing', () => {
    const result = verifyWebhook({
      secret,
      signatureHeader: `t=${now},v1=123456`,
      rawBody: body,
      nowSec: now,
    });

    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });
});
