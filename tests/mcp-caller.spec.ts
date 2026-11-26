/**
 * tests/mcp-caller.spec.ts
 *
 * Identifying MCP callers by API key on the hosted endpoint (AGS016).
 *
 * A keyed agent must be counted as that key — with its tier's budget — not as
 * whichever IP its cloud egress happens to use, and the raw key must never
 * reach a tool handler.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { POST } from '@/app/api/mcp/route';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import { generateApiKey } from '@/lib/auth/api-keys';
import { InMemoryApiKeyStore, _setApiKeyStore, type ApiKeyRecord } from '@/lib/auth/key-store';
import {
  RATE_LIMITED_ERROR_CODE,
  RATE_LIMITED_META_KEY,
  applyToolRateLimit,
  resolveClientId,
  type RateLimitedErrorData,
} from '@/lib/mcp/rate-limit';

const MCP_ACCEPT = 'application/json, text/event-stream';

interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

type ToolResult = {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  _meta?: Record<string, unknown>;
};

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

async function readJsonRpc(response: Response): Promise<JsonRpcResponse> {
  const text = await response.text();
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data:'));
  return JSON.parse(line ? line.slice('data:'.length).trim() : text) as JsonRpcResponse;
}

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

function standardKeyRecord(key: Awaited<ReturnType<typeof generateApiKey>>): ApiKeyRecord {
  return {
    keyId: key.keyId,
    displayPrefix: key.displayPrefix,
    hash: key.hash,
    name: 'Agent Key',
    scopes: ['quotes:read', 'intents:write'],
    tier: 'standard',
    maxIntentAmount: '5000',
    createdAt: new Date().toISOString(),
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
  };
}

describe('POST /api/mcp — caller identity', () => {
  let store: InMemoryApiKeyStore;

  beforeEach(() => {
    store = new InMemoryApiKeyStore();
    _setApiKeyStore(store);
    clearRateLimitStore();
  });

  afterEach(() => {
    _setApiKeyStore(null);
    vi.unstubAllEnvs();
  });

  it('rejects an invalid API key with a JSON-RPC 401', async () => {
    const response = await POST(mcpRequest(INITIALIZE, { authorization: 'Bearer not-a-real-key' }));

    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toBe(
      'Bearer realm="stellar-intel", error="invalid_token"'
    );

    const body = await readJsonRpc(response);
    expect(body.error?.code).toBe(-32001);
    expect(body.error?.message).toBeTruthy();
    expect(body.result).toBeUndefined();
  });

  it('serves initialize and tools/list to a valid key', async () => {
    const key = await generateApiKey();
    await store.create(standardKeyRecord(key));
    const headers = { authorization: `Bearer ${key.key}` };

    const initialized = await POST(mcpRequest(INITIALIZE, headers));
    expect(initialized.status).toBe(200);
    const initBody = await readJsonRpc(initialized);
    expect(initBody.error).toBeUndefined();
    expect(initBody.result?.serverInfo).toBeDefined();

    const listed = await POST(
      mcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, headers)
    );
    expect(listed.status).toBe(200);
    const listBody = await readJsonRpc(listed);
    const tools = (listBody.result?.tools ?? []) as Array<{ name: string }>;
    expect(tools.map((t) => t.name)).toContain('intel.offramp.quote');
  });
});

describe('resolveClientId — keyed identity', () => {
  const standardAuth: AuthInfo = {
    token: '',
    clientId: 'key:0123456789abcdef',
    scopes: ['quotes:read'],
    extra: { kind: 'key', tier: 'standard', rateLimitKey: 'key:0123456789abcdef' },
  };

  it('prefers the key rate-limit key over a forwarded IP', () => {
    expect(
      resolveClientId({
        authInfo: standardAuth,
        requestInfo: { headers: { 'x-forwarded-for': '203.0.113.7' } },
      })
    ).toBe('key:0123456789abcdef');
  });

  it('keeps the existing IP fallback when there is no authInfo', () => {
    expect(
      resolveClientId({ requestInfo: { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } } })
    ).toBe('ip:203.0.113.7');
  });

  it('ignores a non-key rateLimitKey and falls back to the IP', () => {
    expect(
      resolveClientId({
        authInfo: { ...standardAuth, extra: { rateLimitKey: '203.0.113.7' } },
        requestInfo: { headers: { 'x-forwarded-for': '198.51.100.9' } },
      })
    ).toBe('ip:198.51.100.9');
  });
});

describe('applyToolRateLimit — tiered limits via authInfo', () => {
  beforeEach(() => {
    clearRateLimitStore();
  });

  it('gives a standard-key caller 5× the base tool limit', async () => {
    const authInfo: AuthInfo = {
      token: '',
      clientId: 'key:0123456789abcdef',
      scopes: ['quotes:read'],
      extra: { kind: 'key', tier: 'standard', rateLimitKey: 'key:0123456789abcdef' },
    };

    const server = new McpServer({ name: 'test-server', version: '0.0.0' });
    applyToolRateLimit(server, { maxRequests: 1, windowMs: 60_000 });
    server.registerTool(
      'test.echo',
      { description: 'Echo a fixed value', inputSchema: {} },
      async () => ({ content: [{ type: 'text' as const, text: 'ok' }] })
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    // authInfo is transport-level, so inject it on every outbound message —
    // exactly what WebStandardStreamableHTTPServerTransport does for HTTP.
    const send = clientTransport.send.bind(clientTransport);
    clientTransport.send = (message, options) => send(message, { ...options, authInfo });

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const call = () => client.callTool({ name: 'test.echo', arguments: {} }) as Promise<ToolResult>;

    // 1 × TIER_MULTIPLIER.standard (5) = 5 allowed calls.
    for (let i = 0; i < 5; i += 1) {
      const result = await call();
      expect(result.isError).toBeFalsy();
    }

    const limited = await call();
    expect(limited.isError).toBe(true);
    const data = limited._meta?.[RATE_LIMITED_META_KEY] as RateLimitedErrorData | undefined;
    expect(data?.code).toBe(RATE_LIMITED_ERROR_CODE);
    expect(data?.limit).toBe(5);

    await client.close();
  });

  it('keeps the anonymous limit unchanged when no authInfo is delivered', async () => {
    const server = new McpServer({ name: 'test-server', version: '0.0.0' });
    applyToolRateLimit(server, { maxRequests: 1, windowMs: 60_000 });
    server.registerTool(
      'test.echo',
      { description: 'Echo a fixed value', inputSchema: {} },
      async () => ({ content: [{ type: 'text' as const, text: 'ok' }] })
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const first = (await client.callTool({ name: 'test.echo', arguments: {} })) as ToolResult;
    expect(first.isError).toBeFalsy();

    const limited = (await client.callTool({ name: 'test.echo', arguments: {} })) as ToolResult;
    expect(limited.isError).toBe(true);
    const data = limited._meta?.[RATE_LIMITED_META_KEY] as RateLimitedErrorData | undefined;
    expect(data?.limit).toBe(1);

    await client.close();
  });
});
