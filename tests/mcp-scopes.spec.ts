import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { POST } from '@/app/api/mcp/route';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import { clearApiKeys, registerApiKey } from '@/lib/auth/caller';
import { flags } from '@/lib/flags';
import {
  AUTH_META_KEY,
  INSUFFICIENT_SCOPE_ERROR_CODE,
  TOOL_SCOPES,
  applyToolScopes,
} from '@/lib/mcp/scopes';
import * as mcpOfframp from '@/lib/mcp/offramp';

const MCP_ACCEPT = 'application/json, text/event-stream';

const EXPECTED_TOOLS = [
  'intel.offramp.quote',
  'intel.offramp.prepare',
  'intel.execute',
  'intel.anchor.reputation',
  'intel.anchor.health',
  'intel.probe.coverage',
  'intel.leaderboard',
  'intel.corridors',
  'intel.onramp.quote',
  'intel.onramp.prepare',
];

interface JsonRpcToolResponse {
  jsonrpc: string;
  id: number | string | null;
  result?: {
    isError?: boolean;
    content?: Array<{ type: string; text: string }>;
    _meta?: Record<string, Record<string, unknown>>;
  };
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

async function readJsonRpc(response: Response): Promise<JsonRpcToolResponse> {
  const text = await response.text();
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data:'));
  return JSON.parse(line ? line.slice('data:'.length).trim() : text) as JsonRpcToolResponse;
}

describe('MCP per-tool scopes (#2210)', () => {
  const originalRequireKeyForWrites = flags.requireKeyForWrites;

  beforeEach(() => {
    clearRateLimitStore();
    clearApiKeys();
    flags.requireKeyForWrites = false;
  });

  afterEach(() => {
    flags.requireKeyForWrites = originalRequireKeyForWrites;
    vi.restoreAllMocks();
  });

  it('denies intel.offramp.prepare for a key with only quotes:read without calling prepareIntent', async () => {
    registerApiKey({
      id: 'key-quotes-only',
      key: 'sk_quotes_only',
      tier: 'free',
      scopes: ['quotes:read'],
    });

    const spy = vi.spyOn(mcpOfframp, 'prepareIntent');

    const response = await POST(
      mcpRequest(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'intel.offramp.prepare',
            arguments: {
              type: 'offramp',
              sourceAsset: 'USDC',
              destinationAsset: 'NGN',
              amount: '100',
              sender: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
              recipient: 'NGN-BANK-ACCOUNT-123',
            },
          },
        },
        { 'x-api-key': 'sk_quotes_only' }
      )
    );

    expect(response.status).toBe(200);
    const body = await readJsonRpc(response);
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toContain(INSUFFICIENT_SCOPE_ERROR_CODE);
    expect(body.result?._meta?.[AUTH_META_KEY]).toEqual({
      code: INSUFFICIENT_SCOPE_ERROR_CODE,
      tool: 'intel.offramp.prepare',
      requiredScope: 'intents:write',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('allows intel.corridors for the same quotes:read key', async () => {
    registerApiKey({
      id: 'key-quotes-only',
      key: 'sk_quotes_only',
      tier: 'free',
      scopes: ['quotes:read'],
    });

    const response = await POST(
      mcpRequest(
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'intel.corridors',
            arguments: {},
          },
        },
        { 'x-api-key': 'sk_quotes_only' }
      )
    );

    expect(response.status).toBe(200);
    const body = await readJsonRpc(response);
    expect(body.result?.isError).not.toBe(true);
  });

  it('denies anonymous intel.execute when flags.requireKeyForWrites is true', async () => {
    flags.requireKeyForWrites = true;

    const response = await POST(
      mcpRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'intel.execute',
          arguments: {
            unsignedEnvelope: {
              intent: {
                type: 'offramp',
                sourceAsset: 'USDC',
                destinationAsset: 'NGN',
                amount: '100',
                sender: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
                recipient: 'NGN-BANK-ACCOUNT-123',
              },
              intentHash: 'a'.repeat(64),
            },
            signature: 'AAAA',
            signedTx: 'AAAA',
          },
        },
      })
    );

    expect(response.status).toBe(200);
    const body = await readJsonRpc(response);
    expect(body.result?.isError).toBe(true);
    expect(body.result?._meta?.[AUTH_META_KEY]).toEqual({
      code: INSUFFICIENT_SCOPE_ERROR_CODE,
      tool: 'intel.execute',
      requiredScope: 'intents:write',
    });
  });

  it('declares scopes for exactly the expected MCP tools', () => {
    expect(Object.keys(TOOL_SCOPES).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it('throws when registering a tool missing from TOOL_SCOPES', () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    applyToolScopes(server);

    expect(() => {
      server.registerTool('intel.unknown', { description: 'unscoped' }, async () => ({
        content: [{ type: 'text', text: 'ok' }],
      }));
    }).toThrow('No scope declared for MCP tool "intel.unknown"');
  });
});
