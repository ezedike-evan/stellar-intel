/**
 * tests/mcp-http-route.spec.ts
 *
 * The MCP server reached over HTTP on the deployed app, rather than as a
 * subprocess the caller has to install and run.
 *
 * The contract that matters here is that the remote endpoint exposes exactly
 * the same tools as the stdio server — one `createServer()` for both — and that
 * it survives being called more than once, which a stateless transport does not
 * do for free.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE, GET, POST } from '@/app/api/mcp/route';
import { clearRateLimitStore } from '@/lib/api/rate-limit';

const MCP_ACCEPT = 'application/json, text/event-stream';

interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

function mcpRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: MCP_ACCEPT,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Registered by `createServer()` in packages/mcp/src/server.ts. Listed here so
 * a tool silently disappearing from the remote surface fails a test rather than
 * going unnoticed.
 */
const EXPECTED_TOOLS = ['intel.offramp.quote', 'intel.offramp.prepare', 'intel.execute'];

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.0.0' },
  },
};

/** Parses a response body whether it came back as JSON or as an SSE frame. */
async function readJsonRpc(response: Response): Promise<JsonRpcResponse> {
  const text = await response.text();
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data:'));
  return JSON.parse(line ? line.slice('data:'.length).trim() : text) as JsonRpcResponse;
}

describe('POST /api/mcp', () => {
  beforeEach(() => {
    clearRateLimitStore();
  });

  it('completes an initialize handshake', async () => {
    const response = await POST(mcpRequest(INITIALIZE));
    expect(response.status).toBe(200);

    const body = await readJsonRpc(response);
    expect(body.error).toBeUndefined();
    expect(body.result?.serverInfo).toBeDefined();
    expect(body.result?.protocolVersion).toBeDefined();
  }, 30_000);

  it('serves a second request — the transport is rebuilt per invocation', async () => {
    // A stateless WebStandardStreamableHTTPServerTransport throws
    // "Stateless transport cannot be reused across requests" once it has
    // handled one. This is the test that fails if anyone hoists the transport
    // or the server to module scope, which would work exactly once per warm
    // serverless instance and then 500 for the rest of its life.
    const first = await POST(mcpRequest(INITIALIZE));
    expect(first.status).toBe(200);

    const second = await POST(mcpRequest({ ...INITIALIZE, id: 2 }));
    expect(second.status).toBe(200);

    const body = await readJsonRpc(second);
    expect(body.error).toBeUndefined();
    expect(body.result?.serverInfo).toBeDefined();
  }, 30_000);

  it('exposes the same tools as the stdio server', async () => {
    // One createServer() backs both transports, so this is really asserting
    // that the remote endpoint cannot silently drift from the packaged one.
    const response = await POST(
      mcpRequest({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} })
    );
    expect(response.status).toBe(200);

    const body = await readJsonRpc(response);
    const tools = (body.result?.tools ?? []) as Array<{ name: string }>;
    const names = tools.map((t) => t.name);

    expect(names).toEqual(expect.arrayContaining(EXPECTED_TOOLS));
  }, 30_000);

  it('rejects a request that does not accept both content types', async () => {
    const response = await POST(mcpRequest(INITIALIZE, { accept: 'application/json' }));
    expect(response.status).toBe(406);
  }, 30_000);

  it('rejects a body that is not JSON', async () => {
    const response = await POST(mcpRequest(INITIALIZE, { 'content-type': 'text/plain' }));
    expect(response.status).toBe(415);
  }, 30_000);
});

describe('the endpoint is POST-only', () => {
  beforeEach(() => {
    clearRateLimitStore();
  });

  it('answers GET with 405 rather than opening a stream nothing closes', () => {
    // In stateless mode GET would open the spec's standalone SSE stream for
    // server-initiated messages. On a serverless function that is a stream held
    // open until the platform timeout kills it, and this server never initiates
    // messages.
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });

  it('answers DELETE with 405 — there is no session to tear down', () => {
    const response = DELETE();
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });
});
