import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/sep6/withdraw/route';
import { isAllowedAnchorHost, parseAllowedTransferServer } from '@/lib/api/anchor-allowlist';
import { clearRateLimitStore } from '@/lib/api/rate-limit';

// A registered anchor transfer server (mykobo hosts SEP-6 on a subdomain of its
// homeDomain) and a hostile target the proxy must never fetch.
const ALLOWED = 'https://stellar.mykobo.co/sep6';
const ALLOWED_APEX = 'https://cowrie.exchange/sep6';
const METADATA = 'https://169.254.169.254/latest/meta-data';
const LOCALHOST = 'https://localhost/sep6';
const EVIL = 'https://evil.example.com/sep6';

beforeEach(() => {
  clearRateLimitStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('anchor-allowlist', () => {
  it('accepts registered anchor hosts and their subdomains', () => {
    expect(isAllowedAnchorHost('cowrie.exchange')).toBe(true);
    expect(isAllowedAnchorHost('stellar.mykobo.co')).toBe(true); // serviceDomain
    expect(isAllowedAnchorHost('mykobo.co')).toBe(true); // homeDomain
    expect(isAllowedAnchorHost('api.stellar.mykobo.co')).toBe(true); // deeper subdomain
  });

  it('rejects internal, link-local and unregistered hosts', () => {
    expect(isAllowedAnchorHost('169.254.169.254')).toBe(false);
    expect(isAllowedAnchorHost('localhost')).toBe(false);
    expect(isAllowedAnchorHost('evil.example.com')).toBe(false);
    // A lookalike suffix must not be accepted as a subdomain.
    expect(isAllowedAnchorHost('mykobo.co.evil.com')).toBe(false);
    expect(isAllowedAnchorHost('notcowrie.exchange')).toBe(false);
  });

  it('parseAllowedTransferServer requires https and an allowed host', () => {
    expect(parseAllowedTransferServer(ALLOWED)?.hostname).toBe('stellar.mykobo.co');
    expect(parseAllowedTransferServer('http://cowrie.exchange/sep6')).toBeNull(); // not https
    expect(parseAllowedTransferServer(METADATA)).toBeNull();
    expect(parseAllowedTransferServer('not a url')).toBeNull();
  });
});

function postBody(transferServer: string): NextRequest {
  return new NextRequest('http://localhost/api/sep6/withdraw', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1' },
    body: JSON.stringify({
      transferServer,
      assetCode: 'USDC',
      account: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      jwt: 'secret-sep10-token',
    }),
  });
}

describe('POST /api/sep6/withdraw — SSRF guard', () => {
  it('rejects a non-anchor host with 400 and never fetches it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    for (const target of [METADATA, LOCALHOST, EVIL]) {
      const res = await POST(postBody(target));
      expect(res.status).toBe(400);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows a registered anchor host through to the fetch', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const res = await POST(postBody(ALLOWED_APEX));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('cowrie.exchange');
  });
});

function customerReq(transferServer: string, ip = '10.0.0.2'): NextRequest {
  const url = `http://localhost/api/sep6/withdraw?transferServer=${encodeURIComponent(transferServer)}&id=abc`;
  return new NextRequest(url, { headers: { 'x-forwarded-for': ip } });
}

describe('GET /api/sep6/withdraw (customer proxy) — SSRF guard + throttle', () => {
  it('rejects a non-anchor host with 400 and never fetches it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await GET(customerReq(METADATA));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rate-limits the customer proxy (was previously unthrottled)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    const ip = '203.0.113.9';
    let last = 200;
    for (let i = 0; i < 21; i++) {
      const res = await GET(customerReq(ALLOWED_APEX, ip));
      last = res.status;
    }
    // 20 allowed, the 21st in the window is throttled.
    expect(last).toBe(429);
  });
});
