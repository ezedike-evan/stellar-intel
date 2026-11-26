/**
 * tests/mcp-scopes.spec.ts
 *
 * Per-tool scopes in MCP tool dispatch (AGS017, #2210).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const { prepareSpy } = vi.hoisted(() => ({ prepareSpy: vi.fn() }));

vi.mock('@/lib/mcp/offramp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mcp/offramp')>();
  return {
    ...actual,
    prepareIntent: (...args: Parameters<typeof actual.prepareIntent>) => {
      prepareSpy(...args);
      return actual.prepareIntent(...args);
    },
  };
});

import { POST } from '@/app/api/mcp/route';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import { generateApiKey, type ApiScope } from '@/lib/auth/api-keys';
import { InMemoryApiKeyStore, _setApiKeyStore } from '@/lib/auth/key-store';
import { flags } from '@/lib/flags';
import {
  AUTH_META_KEY,
  INSUFFICIENT_SCOPE_ERROR_CODE,
  TOOL_SCOPES,
  applyToolScopes,
  type InsufficientScopeErrorData,
} from '@/lib/mcp/scopes';

const SENDER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

// The tool list the hosted endpoint serves (tests/mcp-http-route.spec.ts), plus
// intel.anchor.sla, which landed after that list was written.
const EXPECTED_TOOLS = [
  'intel.offramp.quote',
  'intel.offramp.prepare',
  'intel.execute',
  'intel.anchor.reputation',
  'intel.anchor.sla',
  'intel.anchor.health',
  'intel.probe.coverage',
  'intel.leaderboard',
  'intel.corridors',
  'intel.onramp.quote',
  'intel.onramp.prepare',
];

interface ToolCallResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  _meta?: Record<string, unknown>;
}

function callTool(name: string, args: Record<string, unknown>, headers: Record<string, string>) {
  return new NextRequest('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
}

async function toolResult(response: Response): Promise<ToolCallResult> {
  const text = await response.text();
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data:'));
  const body = JSON.parse(line ? line.slice('data:'.length).trim() : text) as {
    result?: ToolCallResult;
    error?: { message: string };
  };
  if (!body.result) throw new Error(`no result: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function keyWithScopes(store: InMemoryApiKeyStore, scopes: ApiScope[]): Promise<string> {
  const key = await generateApiKey();
  await store.create({
    keyId: key.keyId,
    displayPrefix: key.displayPrefix,
    hash: key.hash,
    name: 'scoped key',
    scopes,
    tier: 'standard',
    maxIntentAmount: null,
    createdAt: new Date().toISOString(),
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
  });
  return key.key;
}

const PREPARE_ARGS = {
  type: 'offramp',
  sourceAsset: 'USDC',
  destinationAsset: 'NGN',
  amount: '10',
  sender: SENDER,
  recipient: 'NGN-BANK-ACCOUNT-123',
};

describe('MCP tool scopes on the hosted endpoint (AGS017)', () => {
  let store: InMemoryApiKeyStore;

  beforeEach(() => {
    store = new InMemoryApiKeyStore();
    _setApiKeyStore(store);
    clearRateLimitStore();
    prepareSpy.mockClear();
  });

  afterEach(() => {
    _setApiKeyStore(null);
    flags.requireKeyForWrites = false;
  });

  it('refuses intel.offramp.prepare to a quotes:read key without reaching the handler', async () => {
    const key = await keyWithScopes(store, ['quotes:read']);

    const result = await toolResult(
      await POST(
        callTool('intel.offramp.prepare', PREPARE_ARGS, { authorization: `Bearer ${key}` })
      )
    );

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toMatch(new RegExp(`^${INSUFFICIENT_SCOPE_ERROR_CODE}:`));
    const data = result._meta?.[AUTH_META_KEY] as InsufficientScopeErrorData | undefined;
    expect(data).toEqual({
      code: INSUFFICIENT_SCOPE_ERROR_CODE,
      tool: 'intel.offramp.prepare',
      requiredScope: 'intents:write',
    });
    expect(prepareSpy).not.toHaveBeenCalled();
  });

  it('serves intel.corridors to the same key', async () => {
    const key = await keyWithScopes(store, ['quotes:read']);

    const result = await toolResult(
      await POST(callTool('intel.corridors', {}, { authorization: `Bearer ${key}` }))
    );

    expect(result.isError).toBeFalsy();
    expect(result._meta?.[AUTH_META_KEY]).toBeUndefined();
  });

  it('denies anonymous intel.execute when requireKeyForWrites is on', async () => {
    flags.requireKeyForWrites = true;

    const result = await toolResult(
      await POST(
        callTool(
          'intel.execute',
          {
            unsignedEnvelope: { intent: PREPARE_ARGS, intentHash: 'a'.repeat(64) },
            signature: 'c2ln',
            signedTx: 'AAAA',
            dryRun: true,
          },
          { 'x-forwarded-for': '1.2.3.4' }
        )
      )
    );

    expect(result.isError).toBe(true);
    const data = result._meta?.[AUTH_META_KEY] as InsufficientScopeErrorData | undefined;
    expect(data?.requiredScope).toBe('intents:write');
  });

  it('declares a scope for exactly the served tools', () => {
    expect(Object.keys(TOOL_SCOPES).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it('refuses to register a tool with no declared scope', () => {
    const server = new McpServer({ name: 'test-server', version: '0.0.0' });
    applyToolScopes(server);
    expect(() =>
      server.registerTool('intel.unknown', { description: 'x', inputSchema: {} }, async () => ({
        content: [{ type: 'text' as const, text: 'ok' }],
      }))
    ).toThrow('No scope declared for MCP tool "intel.unknown"');
  });
});
