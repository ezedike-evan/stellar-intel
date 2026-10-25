// @vitest-environment node
import http from 'node:http';
import https from 'node:https';
import { afterEach, describe, expect, it, vi } from 'vitest';

// tests/setup.ts installs the guard for every unit spec, so this file exercises
// the real thing (#1411). Nothing here reaches a network: refused requests never
// leave the guard, and the allowed ones point at hosts that cannot resolve.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('network guard', () => {
  it('refuses an unmocked fetch and names the URL and the test', async () => {
    const attempt = fetch('https://example.com/anchor');
    await expect(attempt).rejects.toThrow(/\[network-guard\]/);
    await expect(fetch('https://example.com/anchor')).rejects.toThrow(/example\.com/);
    await expect(fetch('https://example.com/anchor')).rejects.toThrow(
      /refuses an unmocked fetch and names the URL and the test/
    );
  });

  it('refuses a relative URL, which has no server to reach in a unit test', async () => {
    await expect(fetch('/api/snapshot?amount=100')).rejects.toThrow(/\[network-guard\].*snapshot/);
  });

  it('allows data: URLs', async () => {
    const res = await fetch('data:text/plain,hi');
    expect(await res.text()).toBe('hi');
  });

  it('does not treat loopback as unmocked', async () => {
    for (const url of ['http://localhost:1/', 'http://127.0.0.1:1/', 'http://[::1]:1/']) {
      // Nothing listens on port 1, so this fails to connect, but not via the guard.
      const error = await fetch(url).then(
        () => null,
        (e: unknown) => e
      );
      expect(String(error)).not.toContain('[network-guard]');
    }
  });

  it('allows a host listed in TEST_NETWORK_ALLOW', async () => {
    vi.stubEnv('TEST_NETWORK_ALLOW', 'elsewhere.invalid, allowed.invalid');
    const error = await fetch('http://allowed.invalid/').then(
      () => null,
      (e: unknown) => e
    );
    // It gets past the guard and fails to resolve, which is the real network's answer.
    expect(String(error)).not.toContain('[network-guard]');
    await expect(fetch('http://not-listed.invalid/')).rejects.toThrow(/\[network-guard\]/);
  });

  it('lets vi.stubGlobal replace it for a test', async () => {
    const stub = vi.fn().mockResolvedValue(new Response('stubbed'));
    vi.stubGlobal('fetch', stub);

    const res = await fetch('https://example.com/anchor');

    expect(stub).toHaveBeenCalledWith('https://example.com/anchor');
    expect(await res.text()).toBe('stubbed');
    vi.unstubAllGlobals();
  });

  it('refuses https.get and https.request to an outside host', () => {
    expect(() => https.get('https://example.com/')).toThrow(/\[network-guard\].*example\.com/);
    expect(() => https.request({ hostname: 'example.com', path: '/' })).toThrow(
      /\[network-guard\].*example\.com/
    );
  });

  it('refuses http.get and http.request to an outside host', () => {
    expect(() => http.get('http://example.com/')).toThrow(/\[network-guard\]/);
    expect(() => http.request({ host: 'example.com:8080' })).toThrow(/\[network-guard\]/);
  });

  it('allows node http to loopback', async () => {
    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as { port: number };
      const body = await new Promise<string>((resolve, reject) => {
        http
          .get({ host: '127.0.0.1', port }, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve(data));
          })
          .on('error', reject);
      });
      expect(body).toBe('ok');
    } finally {
      server.close();
    }
  });
});
