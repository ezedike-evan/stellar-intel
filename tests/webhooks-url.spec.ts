import { describe, expect, it } from 'vitest';
import { isPublicHttpsUrl } from '@/lib/webhooks/url';

describe('isPublicHttpsUrl', () => {
  it.each([
    'https://example.com/webhook',
    'https://example.com:8443/webhook',
    'https://sub.example.com/hook',
    'https://203.0.113.5/hook',
  ])('accepts %s', (url) => {
    expect(isPublicHttpsUrl(url)).toBe(true);
  });

  it.each([
    ['http://example.com/webhook', 'non-https protocol'],
    ['ftp://example.com/webhook', 'non-https protocol'],
    ['not a url', 'unparseable'],
    ['https://localhost/hook', 'localhost'],
    ['https://foo.localhost/hook', '.localhost suffix'],
    ['https://myservice.local/hook', '.local suffix'],
    ['https://api.internal/hook', '.internal suffix'],
    ['https://127.0.0.1/hook', '127.0.0.0/8'],
    ['https://127.255.255.255/hook', '127.0.0.0/8 upper bound'],
    ['https://10.0.0.1/hook', '10.0.0.0/8'],
    ['https://172.16.0.1/hook', '172.16.0.0/12 lower bound'],
    ['https://172.31.255.255/hook', '172.16.0.0/12 upper bound'],
    ['https://192.168.1.1/hook', '192.168.0.0/16'],
    ['https://169.254.1.1/hook', '169.254.0.0/16'],
    ['https://0.0.0.0/hook', '0.0.0.0'],
    ['https://[::1]/hook', 'IPv6 loopback'],
    ['https://[fc00::1]/hook', 'IPv6 fc00::/7 (fc)'],
    ['https://[fd12:3456::1]/hook', 'IPv6 fc00::/7 (fd)'],
  ])('rejects %s (%s)', (url) => {
    expect(isPublicHttpsUrl(url)).toBe(false);
  });

  it('does not reject an IPv4 address just outside the private ranges', () => {
    expect(isPublicHttpsUrl('https://172.15.255.255/hook')).toBe(true);
    expect(isPublicHttpsUrl('https://172.32.0.1/hook')).toBe(true);
  });
});
