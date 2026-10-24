import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS } from '@/lib/security-headers';

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
