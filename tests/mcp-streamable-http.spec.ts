/**
 * @vitest-environment node
 *
 * Issue #1365 — the standalone streamable-HTTP transport must refuse DNS
 * rebinding, oversized bodies and unbounded sessions.
 *
 * The real transport runs on a real socket; only the MCP server it hosts is
 * swapped for an empty one, since building the full tool server is slow and
 * has nothing to do with what is under test here.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { request as httpRequest } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../packages/mcp/src/server', () => ({
  createServer: async () => new McpServer({ name: 'stub', version: '0.0.0' }),
}));

import { startStreamableHttpServer } from '../packages/mcp/src/transports/streamable-http';
import type { StreamableHttpHandle } from '../packages/mcp/src/transports/streamable-http';

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0.0' },
  },
});

interface RawResponse {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

/** node:http rather than fetch, because fetch will not let a caller set Host. */
function raw(
  port: number,
  opts: { headers?: Record<string, string>; body?: string; chunks?: Buffer[] }
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...opts.headers,
        },
      },
      (res) => {
        const parts: Buffer[] = [];
        res.on('data', (c: Buffer) => parts.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(parts).toString('utf8'),
            headers: res.headers,
          })
        );
      }
    );
    req.on('error', reject);
    if (opts.chunks) {
      for (const chunk of opts.chunks) req.write(chunk);
      req.end();
    } else {
      req.end(opts.body ?? INITIALIZE);
    }
  });
}

function portOf(handle: StreamableHttpHandle): number {
  return Number(new URL(handle.url).port);
}

describe('streamable HTTP transport hardening (#1365)', () => {
  let handle: StreamableHttpHandle;
  let port: number;

  beforeAll(async () => {
    handle = await startStreamableHttpServer({ host: '127.0.0.1', port: 0 });
    port = portOf(handle);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('still serves a normal initialize', async () => {
    const res = await raw(port, {});
    expect(res.status).toBe(200);
    expect(res.headers['mcp-session-id']).toBeTruthy();
  });

  it('accepts the loopback names a local client uses', async () => {
    for (const name of ['localhost', '127.0.0.1']) {
      const res = await raw(port, { headers: { Host: `${name}:${port}` } });
      expect(res.status).toBe(200);
    }
  });

  it('rejects a request whose Host is not the server itself (DNS rebinding)', async () => {
    const res = await raw(port, { headers: { Host: 'evil.example' } });
    expect(res.status).toBe(403);
    expect(res.body).toContain('Invalid Host header');
  });

  it('rejects the right hostname on the wrong port', async () => {
    const res = await raw(port, { headers: { Host: `localhost:${port + 1}` } });
    expect(res.status).toBe(403);
  });

  it('rejects any request carrying an Origin by default', async () => {
    const res = await raw(port, { headers: { Origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect(res.body).toContain('Invalid Origin header');
  });

  it('answers 413 to a 2 MiB body', async () => {
    const res = await raw(port, { body: 'x'.repeat(2 * 1024 * 1024) });
    expect(res.status).toBe(413);
  });

  it('answers 413 to a chunked body that outgrows the cap, without a declared length', async () => {
    const chunk = Buffer.alloc(256 * 1024, 'x');
    const res = await raw(port, { chunks: Array.from({ length: 8 }, () => chunk) });
    expect(res.status).toBe(413);
  });

  it('accepts a body just under the cap', async () => {
    // Padded through a field the protocol allows, so only the size is unusual.
    const message = JSON.parse(INITIALIZE);
    message.params.clientInfo.name = 'x'.repeat(900 * 1024);
    const body = JSON.stringify(message);
    const res = await raw(port, { body });
    expect(res.status).toBe(200);
  });
});

describe('streamable HTTP transport: allowed origins (#1365)', () => {
  it('accepts an Origin that was explicitly allowed, and still refuses others', async () => {
    const handle = await startStreamableHttpServer({
      host: '127.0.0.1',
      port: 0,
      allowedOrigins: ['https://app.example'],
    });
    try {
      const port = portOf(handle);
      const allowed = await raw(port, { headers: { Origin: 'https://app.example' } });
      expect(allowed.status).toBe(200);
      const refused = await raw(port, { headers: { Origin: 'https://evil.example' } });
      expect(refused.status).toBe(403);
    } finally {
      await handle.close();
    }
  });
});

describe('streamable HTTP transport: session cap (#1365)', () => {
  it('answers 503 to an initialize once 100 sessions are open', async () => {
    const handle = await startStreamableHttpServer({ host: '127.0.0.1', port: 0 });
    try {
      const port = portOf(handle);
      for (let i = 0; i < 100; i += 1) {
        const res = await raw(port, {});
        expect(res.status).toBe(200);
      }

      const over = await raw(port, {});
      expect(over.status).toBe(503);
      expect(JSON.parse(over.body)).toMatchObject({
        jsonrpc: '2.0',
        error: { message: 'Too many sessions' },
      });
    } finally {
      await handle.close();
    }
  }, 60_000);
});
