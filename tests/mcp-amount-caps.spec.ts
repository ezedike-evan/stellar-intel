/**
 * tests/mcp-amount-caps.spec.ts
 *
 * Per-call amount caps for intents an agent can prepare or execute (AGS019, #2212).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const { prepareSpy, executeSpy, onrampSpy } = vi.hoisted(() => ({
  prepareSpy: vi.fn(),
  executeSpy: vi.fn(),
  onrampSpy: vi.fn(),
}));

// The handlers are stubbed so no test reaches Horizon or an anchor: a call that
// passes the cap check lands in the stub, which fails with a sentinel error.
vi.mock('@/lib/mcp/offramp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mcp/offramp')>();
  return { ...actual, prepareIntent: prepareSpy, executeIntent: executeSpy };
});
vi.mock('@/lib/mcp/onramp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mcp/onramp')>();
  return { ...actual, prepareOnrampIntent: onrampSpy };
});

import { POST } from '@/app/api/mcp/route';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import { generateApiKey } from '@/lib/auth/api-keys';
import { InMemoryApiKeyStore, _setApiKeyStore } from '@/lib/auth/key-store';
import { createServer } from '@/lib/mcp/server';
import { assertWithinAmountCap, effectiveAmountCap, globalAmountCap } from '@/lib/mcp/safety';

const SENDER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

interface ToolCallResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
}

function offrampArgs(amount: string) {
  return {
    type: 'offramp',
    sourceAsset: 'USDC',
    destinationAsset: 'NGN',
    amount,
    sender: SENDER,
    recipient: 'NGN-BANK-ACCOUNT-123',
  };
}

function callTool(name: string, args: Record<string, unknown>, key: string) {
  return new NextRequest('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${key}`,
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

function text(result: ToolCallResult): string {
  return result.content?.[0]?.text ?? '';
}

describe('effectiveAmountCap', () => {
  it('is null with neither cap', () => {
    expect(effectiveAmountCap(null, {})).toBeNull();
    expect(effectiveAmountCap(undefined, {})).toBeNull();
  });

  it('uses the env cap alone', () => {
    expect(effectiveAmountCap(null, { MCP_MAX_INTENT_AMOUNT: '500' })).toBe('500');
  });

  it('uses the key cap alone', () => {
    expect(effectiveAmountCap('50', {})).toBe('50');
  });

  it('takes the lower of the two, comparing decimals exactly', () => {
    expect(effectiveAmountCap('100.5', { MCP_MAX_INTENT_AMOUNT: '100.25' })).toBe('100.25');
    expect(effectiveAmountCap('100.25', { MCP_MAX_INTENT_AMOUNT: '100.5' })).toBe('100.25');
  });

  it('ignores an invalid env value', () => {
    expect(globalAmountCap({ MCP_MAX_INTENT_AMOUNT: 'abc' })).toBeNull();
    expect(globalAmountCap({ MCP_MAX_INTENT_AMOUNT: '-1' })).toBeNull();
    expect(globalAmountCap({ MCP_MAX_INTENT_AMOUNT: '0' })).toBeNull();
    expect(effectiveAmountCap('50', { MCP_MAX_INTENT_AMOUNT: 'abc' })).toBe('50');
  });

  it('allows an amount equal to the cap and rejects one above it', () => {
    expect(() => assertWithinAmountCap('50', '50')).not.toThrow();
    expect(() => assertWithinAmountCap('50.0000001', '50')).toThrow(/exceeds the 50 cap/);
    expect(() => assertWithinAmountCap('1000000', null)).not.toThrow();
  });
});

describe('amount caps on the hosted endpoint', () => {
  let store: InMemoryApiKeyStore;
  let key: string;

  beforeEach(async () => {
    store = new InMemoryApiKeyStore();
    _setApiKeyStore(store);
    clearRateLimitStore();
    for (const spy of [prepareSpy, executeSpy, onrampSpy]) {
      spy.mockReset();
      spy.mockRejectedValue(new Error('stubbed handler'));
    }
    const generated = await generateApiKey();
    await store.create({
      keyId: generated.keyId,
      displayPrefix: generated.displayPrefix,
      hash: generated.hash,
      name: 'capped key',
      scopes: ['quotes:read', 'intents:write'],
      tier: 'standard',
      maxIntentAmount: '50',
      createdAt: new Date().toISOString(),
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    });
    key = generated.key;
  });

  afterEach(() => {
    _setApiKeyStore(null);
    vi.unstubAllEnvs();
  });

  it('rejects intel.offramp.prepare above the key cap before preparing anything', async () => {
    const result = await toolResult(
      await POST(callTool('intel.offramp.prepare', offrampArgs('50.0000001'), key))
    );

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^AMOUNT_OVER_CAP: /);
    expect(prepareSpy).not.toHaveBeenCalled();
  });

  it('lets an amount equal to the key cap through to the handler', async () => {
    const result = await toolResult(
      await POST(callTool('intel.offramp.prepare', offrampArgs('50'), key))
    );

    expect(text(result)).not.toMatch(/AMOUNT_OVER_CAP/);
    expect(prepareSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects intel.execute above the cap before signature verification', async () => {
    const result = await toolResult(
      await POST(
        callTool(
          'intel.execute',
          {
            unsignedEnvelope: { intent: offrampArgs('51'), intentHash: 'a'.repeat(64) },
            signature: 'c2ln',
            signedTx: 'AAAA',
          },
          key
        )
      )
    );

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^AMOUNT_OVER_CAP: /);
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('rejects intel.onramp.prepare above the cap', async () => {
    const result = await toolResult(
      await POST(
        callTool(
          'intel.onramp.prepare',
          {
            type: 'onramp',
            sourceAsset: 'NGN',
            destinationAsset: 'USDC',
            amount: '75',
            sender: 'payer-ref-1',
            destination: SENDER,
            depositMethod: 'bank_transfer',
          },
          key
        )
      )
    );

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^AMOUNT_OVER_CAP: /);
    expect(onrampSpy).not.toHaveBeenCalled();
  });
});

describe('amount caps over stdio (no key)', () => {
  beforeEach(() => {
    clearRateLimitStore();
    prepareSpy.mockReset();
    prepareSpy.mockRejectedValue(new Error('stubbed handler'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('honours MCP_MAX_INTENT_AMOUNT', async () => {
    vi.stubEnv('MCP_MAX_INTENT_AMOUNT', '10');
    const server = await createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'stdio-like', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = (await client.callTool({
      name: 'intel.offramp.prepare',
      arguments: offrampArgs('11'),
    })) as ToolCallResult;

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^AMOUNT_OVER_CAP: /);
    expect(prepareSpy).not.toHaveBeenCalled();

    await client.close();
  });
});
