/**
 * @vitest-environment node
 *
 * Issue #2213 (AGS020) — MCP tool audit logging.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { POST } from '@/app/api/mcp/route';
import { createServer } from '@/lib/mcp/server';
import { InMemoryAuditStore, _setAuditStore } from '@/lib/audit/store';
import { flushAuditEvents } from '@/lib/audit/record';
import { InMemoryApiKeyStore, _setApiKeyStore } from '@/lib/auth/key-store';
import { hashApiKey } from '@/lib/auth/api-keys';
import { clearRateLimitStore } from '@/lib/api/rate-limit';
import { Keypair } from '@stellar/stellar-sdk';
import * as offrampModule from '@/lib/mcp/offramp';

describe('mcp audit logging (#2213)', () => {
  let auditStore: InMemoryAuditStore;
  const keyRaw = 'sik_0123456789abcdef_1234567890123456789012345678901234567890123';
  const keyId = '0123456789abcdef';

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    clearRateLimitStore();
    auditStore = new InMemoryAuditStore();
    _setAuditStore(auditStore);

    const keyStore = new InMemoryApiKeyStore();
    await keyStore.create({
      keyId,
      displayPrefix: `sik_${keyId}`,
      hash: await hashApiKey(keyRaw),
      name: 'test key',
      scopes: ['quotes:read', 'intents:write'],
      tier: 'standard',
      maxIntentAmount: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    });
    _setApiKeyStore(keyStore);
  });

  async function callHostedTool(name: string, args: Record<string, unknown> = {}, key = keyRaw) {
    const req = new NextRequest('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name, arguments: args },
        id: 1,
      }),
    });
    const res = await POST(req);
    const text = await res.text();
    const line = text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('data:'));
    return JSON.parse(line ? line.slice('data:'.length).trim() : text);
  }

  it('records an ok event when intel.offramp.prepare succeeds with matching intentHash', async () => {
    const sender = Keypair.random().publicKey();
    const recipient = 'recipient-test-123';
    const fakeIntentHash = 'e'.repeat(64);

    vi.spyOn(offrampModule, 'prepareIntent').mockResolvedValueOnce({
      unsignedEnvelope: {
        intent: {
          type: 'offramp',
          sourceAsset: 'USDC',
          destinationAsset: 'NGN',
          amount: '10',
          sender,
          recipient,
        },
        intentHash: fakeIntentHash,
      },
      unsignedTx: 'fake-tx',
    });

    const res = await callHostedTool('intel.offramp.prepare', {
      type: 'offramp',
      sourceAsset: 'USDC',
      destinationAsset: 'NGN',
      amount: '10',
      sender,
      recipient,
    });

    expect(res.result?.isError).toBeFalsy();
    await flushAuditEvents();

    const events = await auditStore.listRange({
      from: '1970-01-01T00:00:00Z',
      to: '2099-01-01T00:00:00Z',
      limit: 10,
    });

    expect(events.length).toBe(1);
    const event = events[0]!;
    expect(event.surface).toBe('mcp');
    expect(event.action).toBe('intel.offramp.prepare');
    expect(event.scope).toBe('intents:write');
    expect(event.outcome).toBe('ok');
    expect(event.intentHash).toBe(fakeIntentHash);
    expect(event.callerId).toBe(`key:${keyId}`);

    // Excludes PII (sender and recipient)
    const jsonStr = JSON.stringify(event);
    expect(jsonStr).not.toContain(sender);
    expect(jsonStr).not.toContain(recipient);
  });

  it('records an ok event for intel.corridors with null intentHash', async () => {
    await callHostedTool('intel.corridors');
    await flushAuditEvents();

    const events = await auditStore.listRange({
      from: '1970-01-01T00:00:00Z',
      to: '2099-01-01T00:00:00Z',
      limit: 10,
    });

    expect(events.length).toBe(1);
    const event = events[0]!;
    expect(event.surface).toBe('mcp');
    expect(event.action).toBe('intel.corridors');
    expect(event.scope).toBe('quotes:read');
    expect(event.outcome).toBe('ok');
    expect(event.intentHash).toBeNull();
  });

  it('records denied for scope-denied call', async () => {
    // Create quotes-only key
    const quotesKey = 'sik_1111111111111111_1234567890123456789012345678901234567890123';
    const quotesKeyId = '1111111111111111';
    const store = new InMemoryApiKeyStore();
    await store.create({
      keyId: quotesKeyId,
      displayPrefix: `sik_${quotesKeyId}`,
      hash: await hashApiKey(quotesKey),
      name: 'quotes only',
      scopes: ['quotes:read'],
      tier: 'standard',
      maxIntentAmount: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    });
    _setApiKeyStore(store);

    const res = await callHostedTool(
      'intel.offramp.prepare',
      {
        type: 'offramp',
        sourceAsset: 'USDC',
        destinationAsset: 'NGN',
        amount: '10',
        sender: Keypair.random().publicKey(),
        recipient: 'recip',
      },
      quotesKey
    );

    expect(res.result?.isError).toBe(true);
    await flushAuditEvents();

    const events = await auditStore.listRange({
      from: '1970-01-01T00:00:00Z',
      to: '2099-01-01T00:00:00Z',
      limit: 10,
    });

    expect(events.length).toBe(1);
    expect(events[0]!.outcome).toBe('denied');
    expect(events[0]!.action).toBe('intel.offramp.prepare');
  });

  it('records rate_limited for rate-limited call', async () => {
    clearRateLimitStore();
    vi.stubEnv('MCP_RATE_LIMIT_MAX', '1');

    // First call succeeds
    await callHostedTool('intel.corridors');
    // Second call is rate-limited
    const res = await callHostedTool('intel.corridors');

    expect(res.result?.isError).toBe(true);
    await flushAuditEvents();

    const events = await auditStore.listRange({
      from: '1970-01-01T00:00:00Z',
      to: '2099-01-01T00:00:00Z',
      limit: 10,
    });

    expect(events.length).toBe(2);
    expect(events[0]!.outcome).toBe('ok');
    expect(events[1]!.outcome).toBe('rate_limited');
  });

  it('records nothing for an in-memory client without authInfo', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = await createServer();
    await server.connect(serverTransport);

    const client = new Client({ name: 'in-memory-client', version: '1.0.0' });
    await client.connect(clientTransport);

    await client.callTool({
      name: 'intel.corridors',
      arguments: {},
    });

    await flushAuditEvents();

    const events = await auditStore.listRange({
      from: '1970-01-01T00:00:00Z',
      to: '2099-01-01T00:00:00Z',
      limit: 10,
    });

    expect(events.length).toBe(0);

    await client.close();
    await server.close();
  });
});
