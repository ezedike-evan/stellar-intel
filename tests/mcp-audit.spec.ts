/**
 * tests/mcp-audit.spec.ts
 *
 * Hosted MCP tool calls are recorded in the audit log, without their arguments
 * (AGS020, #2213).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const SENDER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const RECIPIENT = 'NGN-BANK-ACCOUNT-987654';
const INTENT_HASH = 'b'.repeat(64);

const { prepareSpy } = vi.hoisted(() => ({ prepareSpy: vi.fn() }));

// The prepare handler is stubbed so the test needs no Horizon account: it
// returns a schema-valid envelope with a known intent hash.
vi.mock('@/lib/mcp/offramp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mcp/offramp')>();
  return { ...actual, prepareIntent: prepareSpy };
});

import { POST } from '@/app/api/mcp/route';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import { generateApiKey, type ApiScope } from '@/lib/auth/api-keys';
import { InMemoryApiKeyStore, _setApiKeyStore } from '@/lib/auth/key-store';
import { InMemoryAuditStore, _setAuditStore } from '@/lib/audit/store';
import { flushAuditEvents } from '@/lib/audit/record';
import type { AuditEvent } from '@/lib/audit/types';
import { createServer } from '@/lib/mcp/server';

const PREPARE_ARGS = {
  type: 'offramp',
  sourceAsset: 'USDC',
  destinationAsset: 'NGN',
  amount: '10',
  sender: SENDER,
  recipient: RECIPIENT,
};

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
      id: 7,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
}

async function resultOf(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data:'));
  const body = JSON.parse(line ? line.slice('data:'.length).trim() : text) as {
    result?: Record<string, unknown>;
  };
  return body.result ?? {};
}

describe('MCP tool audit (AGS020)', () => {
  let keys: InMemoryApiKeyStore;
  let audit: InMemoryAuditStore;

  async function makeKey(scopes: ApiScope[]): Promise<{ key: string; keyId: string }> {
    const generated = await generateApiKey();
    await keys.create({
      keyId: generated.keyId,
      displayPrefix: generated.displayPrefix,
      hash: generated.hash,
      name: 'audited key',
      scopes,
      tier: 'standard',
      maxIntentAmount: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    });
    return { key: generated.key, keyId: generated.keyId };
  }

  async function events(): Promise<AuditEvent[]> {
    await flushAuditEvents();
    return audit.listRange({
      from: '2000-01-01T00:00:00.000Z',
      to: '2100-01-01T00:00:00.000Z',
      limit: 100,
    });
  }

  beforeEach(() => {
    keys = new InMemoryApiKeyStore();
    _setApiKeyStore(keys);
    audit = new InMemoryAuditStore();
    _setAuditStore(audit);
    clearRateLimitStore();
    prepareSpy.mockReset();
    prepareSpy.mockResolvedValue({
      unsignedEnvelope: { intent: PREPARE_ARGS, intentHash: INTENT_HASH },
      unsignedTx: 'AAAA',
    });
  });

  afterEach(() => {
    _setApiKeyStore(null);
    _setAuditStore(null);
    vi.unstubAllEnvs();
  });

  it('records a successful prepare as ok, with the intent hash and no arguments', async () => {
    const { key, keyId } = await makeKey(['quotes:read', 'intents:write']);

    const result = await resultOf(await POST(callTool('intel.offramp.prepare', PREPARE_ARGS, key)));
    expect(result.isError).toBeFalsy();

    const recorded = await events();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      surface: 'mcp',
      action: 'intel.offramp.prepare',
      scope: 'intents:write',
      callerId: `key:${keyId}`,
      callerKind: 'key',
      intentHash: INTENT_HASH,
      outcome: 'ok',
      status: null,
      requestId: '7',
    });
    const serialized = JSON.stringify(recorded);
    expect(serialized).not.toContain(SENDER);
    expect(serialized).not.toContain(RECIPIENT);
  });

  it('records intel.corridors as ok with a null intent hash', async () => {
    const { key } = await makeKey(['quotes:read']);

    await POST(callTool('intel.corridors', {}, key));

    const recorded = await events();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      action: 'intel.corridors',
      outcome: 'ok',
      intentHash: null,
    });
  });

  it('records a scope-denied call as denied', async () => {
    const { key } = await makeKey(['quotes:read']);

    await POST(callTool('intel.offramp.prepare', PREPARE_ARGS, key));

    const recorded = await events();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.outcome).toBe('denied');
    expect(prepareSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(recorded)).not.toContain(SENDER);
  });

  it('records a rate-limited call as rate_limited', async () => {
    vi.stubEnv('MCP_RATE_LIMIT_MAX', '1');
    // A standard key gets 5× the base limit, so the sixth call is refused.
    const { key } = await makeKey(['quotes:read']);

    for (let i = 0; i < 6; i += 1) {
      await POST(callTool('intel.corridors', {}, key));
    }

    const recorded = await events();
    expect(recorded.map((e) => e.outcome)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'rate_limited']);
  });

  it('records nothing for an in-memory client without authInfo', async () => {
    const server = await createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'stdio-like', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    await client.callTool({ name: 'intel.corridors', arguments: {} });
    await client.callTool({ name: 'intel.offramp.prepare', arguments: PREPARE_ARGS });

    expect(await events()).toEqual([]);
    await client.close();
  });
});
