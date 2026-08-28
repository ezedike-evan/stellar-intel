import { describe, it, expect } from 'vitest';
import { buildSignatureHeader, verifySignatureHeader } from '@/lib/webhooks/sign';

const SECRET = 'test-secret-key';
const RAW_BODY = '{"id":"evt-1","kind":"intent.created"}';
const NOW_SEC = Math.floor(Date.now() / 1000);

describe('buildSignatureHeader', () => {
  it('produces a header with t and v1 fields', () => {
    const header = buildSignatureHeader(SECRET, NOW_SEC, RAW_BODY);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('embeds the given timestamp', () => {
    const header = buildSignatureHeader(SECRET, NOW_SEC, RAW_BODY);
    expect(header.startsWith(`t=${NOW_SEC},`)).toBe(true);
  });

  it('produces different signatures for different secrets', () => {
    const h1 = buildSignatureHeader(SECRET, NOW_SEC, RAW_BODY);
    const h2 = buildSignatureHeader('other-secret', NOW_SEC, RAW_BODY);
    expect(h1).not.toBe(h2);
  });

  it('produces different signatures for different bodies', () => {
    const h1 = buildSignatureHeader(SECRET, NOW_SEC, RAW_BODY);
    const h2 = buildSignatureHeader(SECRET, NOW_SEC, RAW_BODY + ' ');
    expect(h1).not.toBe(h2);
  });
});

describe('verifySignatureHeader', () => {
  it('accepts a correctly signed payload', () => {
    const header = buildSignatureHeader(SECRET, NOW_SEC, RAW_BODY);
    expect(verifySignatureHeader(SECRET, header, RAW_BODY)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const header = buildSignatureHeader(SECRET, NOW_SEC, RAW_BODY);
    expect(verifySignatureHeader(SECRET, header, RAW_BODY + 'x')).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const header = buildSignatureHeader(SECRET, NOW_SEC, RAW_BODY);
    const tampered = header.replace(/v1=[0-9a-f]{4}/, 'v1=0000');
    expect(verifySignatureHeader(SECRET, tampered, RAW_BODY)).toBe(false);
  });

  it('rejects a payload signed with a different secret', () => {
    const header = buildSignatureHeader('wrong-secret', NOW_SEC, RAW_BODY);
    expect(verifySignatureHeader(SECRET, header, RAW_BODY)).toBe(false);
  });

  it('rejects a stale timestamp beyond the tolerance window', () => {
    const stale = NOW_SEC - 400;
    const header = buildSignatureHeader(SECRET, stale, RAW_BODY);
    expect(verifySignatureHeader(SECRET, header, RAW_BODY, 300)).toBe(false);
  });

  it('accepts a timestamp within the tolerance window', () => {
    const recent = NOW_SEC - 60;
    const header = buildSignatureHeader(SECRET, recent, RAW_BODY);
    expect(verifySignatureHeader(SECRET, header, RAW_BODY, 300)).toBe(true);
  });

  it('rejects a malformed header with no t field', () => {
    expect(verifySignatureHeader(SECRET, 'v1=abc', RAW_BODY)).toBe(false);
  });

  it('rejects a malformed header with no v1 field', () => {
    expect(verifySignatureHeader(SECRET, `t=${NOW_SEC}`, RAW_BODY)).toBe(false);
  });
});
