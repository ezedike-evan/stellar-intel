import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import { createServer } from './server.js';
import { ANCHOR_HEALTH_TOOL_NAME } from './tools/anchor-health.js';
import {
  MCP_TOOL_RATE_LIMIT_BUCKET,
  RATE_LIMITED_ERROR_CODE,
  RATE_LIMITED_META_KEY,
  resolveClientId,
  type RateLimitedErrorData,
} from './rate-limit.js';

type ToolResult = {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  _meta?: Record<string, unknown>;
};

/** The typed rate-limit payload from a result, or undefined if it is not one. */
function rateLimitData(result: unknown): RateLimitedErrorData | undefined {
  return (result as ToolResult)._meta?.[RATE_LIMITED_META_KEY] as RateLimitedErrorData | undefined;
}

const mockFetch = vi.fn();

async function connectedClient(): Promise<Client> {
  const server = await createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** A successful anchor-health response, so an allowed call has something to return. */
function anchorHealthOk(): void {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        anchorId: 'cowrie',
        status: 'ok',
        consecutiveFailures: 0,
        degraded: false,
        lastCheckedAt: '2026-01-15T12:00:00.000Z',
        lastError: null,
        stale: false,
      }),
  });
}

describe('resolveClientId', () => {
  it('prefers the transport session id', () => {
    expect(resolveClientId({ sessionId: 'abc-123' })).toBe('session:abc-123');
  });

  it('falls back to the first forwarded IP, then to x-real-ip', () => {
    expect(
      resolveClientId({ requestInfo: { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } } })
    ).toBe('ip:203.0.113.7');
    expect(resolveClientId({ requestInfo: { headers: { 'x-real-ip': '198.51.100.9' } } })).toBe(
      'ip:198.51.100.9'
    );
  });

  it('reads an array-valued header', () => {
    expect(
      resolveClientId({ requestInfo: { headers: { 'x-forwarded-for': ['203.0.113.7'] } } })
    ).toBe('ip:203.0.113.7');
  });

  it('resolves stdio (no session, no headers) to a single local key', () => {
    expect(resolveClientId({})).toBe('local');
  });

  it('does not confuse two sessions', () => {
    expect(resolveClientId({ sessionId: 'a' })).not.toBe(resolveClientId({ sessionId: 'b' }));
  });
});

describe('MCP tool rate limiting', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    // The in-process limiter store is module-level; without this each test
    // inherits the previous one's spent budget.
    clearRateLimitStore();
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    // A cap of 2 keeps the test to three calls rather than sixty-one.
    process.env.MCP_RATE_LIMIT_MAX = '2';
    process.env.MCP_RATE_LIMIT_WINDOW_MS = '60000';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MCP_RATE_LIMIT_MAX;
    delete process.env.MCP_RATE_LIMIT_WINDOW_MS;
  });

  it('rejects the call past the cap and never calls the anchor', async () => {
    anchorHealthOk();
    const client = await connectedClient();
    const call = () =>
      client.callTool({ name: ANCHOR_HEALTH_TOOL_NAME, arguments: { domain: 'cowrie.exchange' } });

    const first = (await call()) as ToolResult;
    const second = (await call()) as ToolResult;
    expect(first.isError).toBeFalsy();
    expect(second.isError).toBeFalsy();
    const callsBeforeLimit = mockFetch.mock.calls.length;

    const limited = (await call()) as ToolResult;
    expect(limited.isError).toBe(true);

    // The whole point: a rejected call costs the anchor nothing.
    expect(mockFetch.mock.calls.length).toBe(callsBeforeLimit);

    await client.close();
  });

  it('carries typed data a client can branch on', async () => {
    anchorHealthOk();
    const client = await connectedClient();
    const call = () =>
      client.callTool({ name: ANCHOR_HEALTH_TOOL_NAME, arguments: { domain: 'cowrie.exchange' } });

    await call();
    await call();
    const limited = (await call()) as ToolResult;

    const data = rateLimitData(limited);
    expect(data).toBeDefined();
    expect(data?.code).toBe(RATE_LIMITED_ERROR_CODE);
    expect(data?.tool).toBe(ANCHOR_HEALTH_TOOL_NAME);
    expect(data?.limit).toBe(2);
    expect(data?.retryAfter).toBeGreaterThan(0);
    expect(data?.resetAt).toBeGreaterThan(Date.now());
    expect(typeof data?.shared).toBe('boolean');

    // The text body leads with the same code, matching how every other tool in
    // this server reports a typed failure.
    expect(limited.content?.[0]?.text).toContain(`${RATE_LIMITED_ERROR_CODE}:`);

    await client.close();
  });

  it('is distinguishable from an ordinary tool failure', async () => {
    // An anchor error is also `isError`, but carries no rate-limit payload —
    // so a client can tell "you were throttled" from "the anchor is down".
    mockFetch.mockResolvedValue({ ok: false, status: 503, text: () => Promise.resolve('down') });
    const client = await connectedClient();

    const failed = (await client.callTool({
      name: ANCHOR_HEALTH_TOOL_NAME,
      arguments: { domain: 'cowrie.exchange' },
    })) as ToolResult;

    expect(failed.isError).toBe(true);
    expect(rateLimitData(failed)).toBeUndefined();

    await client.close();
  });

  it('counts each tool in its own bucket', async () => {
    // Two tools, one cap each: the second tool is unaffected by the first
    // having been exhausted.
    anchorHealthOk();
    const client = await connectedClient();

    const health = () =>
      client.callTool({ name: ANCHOR_HEALTH_TOOL_NAME, arguments: { domain: 'cowrie.exchange' } });

    await health();
    await health();
    expect(rateLimitData(await health())).toBeDefined();

    // A different tool still answers — it has its own bucket.
    const other = (await client.callTool({
      name: 'intel.anchor.reputation',
      arguments: { domain: 'cowrie.exchange' },
    })) as ToolResult;
    expect(rateLimitData(other)).toBeUndefined();

    await client.close();
  });

  it('names a bucket that cannot collide with the REST v1 buckets', () => {
    expect(MCP_TOOL_RATE_LIMIT_BUCKET.startsWith('v1.')).toBe(false);
    expect(MCP_TOOL_RATE_LIMIT_BUCKET).toBe('mcp.tools');
  });
});
