import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS, buildCspReportOnly } from '@/lib/security-headers';

const asMap = () => new Map(SECURITY_HEADERS.map((h) => [h.key, h.value]));

describe('SECURITY_HEADERS (#1359)', () => {
  it('stops MIME sniffing', () => {
    expect(asMap().get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('forbids framing', () => {
    expect(asMap().get('X-Frame-Options')).toBe('DENY');
  });

  it('limits what the Referer header leaks', () => {
    expect(asMap().get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('turns off powerful browser features the app never uses', () => {
    expect(asMap().get('Permissions-Policy')).toBe(
      'camera=(), microphone=(), geolocation=(), payment=()'
    );
  });

  it('lists each header once', () => {
    expect(asMap().size).toBe(SECURITY_HEADERS.length);
  });
});

describe('buildCspReportOnly (#1360)', () => {
  const csp = buildCspReportOnly();

  it('is exactly the agreed policy', () => {
    expect(csp).toBe(
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://plausible.io; " +
        "style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; " +
        "connect-src 'self' https:; frame-src https:; frame-ancestors 'none'; " +
        "base-uri 'self'; form-action 'self'; object-src 'none'"
    );
  });

  it('forbids framing and plugins, and allows the analytics script', () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('https://plausible.io');
  });

  it('never allows eval', () => {
    expect(csp).not.toContain("'unsafe-eval'");
  });
});
