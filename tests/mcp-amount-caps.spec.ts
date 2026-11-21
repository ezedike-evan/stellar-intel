/**
 * @vitest-environment node
 *
 * Issue #2212 (AGS019) — per-call amount caps for MCP intents.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { POST } from '@/app/api/mcp/route';
import { createServer } from '@/lib/mcp/server';
import {
  effectiveAmountCap,
  globalAmountCap,
  _resetWarnedInvalidCap,
} from '@/lib/mcp/safety';
import { InMemoryApiKeyStore, _setApiKeyStore } from '@/lib/auth/key-store';
import { hashApiKey } from '@/lib/auth/api-keys';
import * as offrampModule from '@/lib/mcp/offramp';
import { Keypair } from '@stellar/stellar-sdk';

async function readJsonRpc(response: Response) {
  const text = await response.text();
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data:'));
  return JSON.parse(line ? line.slice('data:'.length).trim() : text);
}

describe('mcp amount caps (#2212)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    _resetWarnedInvalidCap();
    _setApiKeyStore(null);
  });

  describe('effectiveAmountCap unit tests', () => {
    it('handles null/null -> null', () => {
      expect(effectiveAmountCap(null, {})).toBeNull();
      expect(effectiveAmountCap(undefined, {})).toBeNull();
    });

    it('returns env only when caller cap is not set', () => {
      expect(effectiveAmountCap(null, { MCP_MAX_INTENT_AMOUNT: '100' })).toBe('100');
    });

    it('returns key only when env cap is not set', () => {
      expect(effectiveAmountCap('50', {})).toBe('50');
    });

    it('returns the lower of the two including decimals', () => {
      expect(effectiveAmountCap('100.25', { MCP_MAX_INTENT_AMOUNT: '100.5' })).toBe('100.25');
      expect(effectiveAmountCap('100.5', { MCP_MAX_INTENT_AMOUNT: '100.25' })).toBe('100.25');
      expect(effectiveAmountCap('50', { MCP_MAX_INTENT_AMOUNT: '100' })).toBe('50');
      expect(effectiveAmountCap('150', { MCP_MAX_INTENT_AMOUNT: '100' })).toBe('100');
    });

    it('ignores invalid env values ("abc", "-1", "0")', () => {
      expect(globalAmountCap({ MCP_MAX_INTENT_AMOUNT: 'abc' })).toBeNull();
      expect(globalAmountCap({ MCP_MAX_INTENT_AMOUNT: '-1' })).toBeNull();
      expect(globalAmountCap({ MCP_MAX_INTENT_AMOUNT: '0' })).toBeNull();

      expect(effectiveAmountCap('50', { MCP_MAX_INTENT_AMOUNT: 'abc' })).toBe('50');
      expect(effectiveAmountCap(null, { MCP_MAX_INTENT_AMOUNT: 'abc' })).toBeNull();
    });
  });

  describe('hosted route with API key', () => {
    const keyRaw = 'sik_0123456789abcdef_1234567890123456789012345678901234567890123';
    const keyId = '0123456789abcdef';

    async function setupKeyStore(maxIntentAmount: string | null = '50') {
      const store = new InMemoryApiKeyStore();
      await store.create({
        keyId,
        displayPrefix: `sik_${keyId}`,
        hash: await hashApiKey(keyRaw),
        name: 'test key',
        scopes: ['quotes:read', 'intents:write', 'admin'],
        tier: 'standard',
        maxIntentAmount,
        createdAt: new Date().toISOString(),
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
      });
      _setApiKeyStore(store);
    }

    it('intel.offramp.prepare with amount > cap gives AMOUNT_OVER_CAP and does not call prepareIntent', async () => {
      await setupKeyStore('50');
      const spyPrepare = vi.spyOn(offrampModule, 'prepareIntent');

      const body = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'intel.offramp.prepare',
          arguments: {
            type: 'offramp',
            sourceAsset: 'USDC',
            destinationAsset: 'NGN',
            amount: '50.0000001',
            sender: Keypair.random().publicKey(),
            recipient: 'recipient-123',
          },
        },
        id: 1,
      };

      const req = new NextRequest('http://localhost:3000/api/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${keyRaw}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(body),
      });

      const res = await POST(req);
      const data = await readJsonRpc(res);

      expect(spyPrepare).not.toHaveBeenCalled();
      expect(data.result?.isError).toBe(true);
      expect(data.result?.content?.[0]?.text).toMatch(/AMOUNT_OVER_CAP/);
    });

    it('intel.execute over the cap is rejected before signature verification', async () => {
      await setupKeyStore('50');
      const spyExecute = vi.spyOn(offrampModule, 'executeIntent');

      const body = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'intel.execute',
          arguments: {
            unsignedEnvelope: {
              intent: {
                type: 'offramp',
                sourceAsset: 'USDC',
                destinationAsset: 'NGN',
                amount: '50.0000001',
                sender: Keypair.random().publicKey(),
                recipient: 'recipient-123',
              },
              intentHash: 'a'.repeat(64),
            },
            signature: 'sig',
            signedTx: 'tx',
          },
        },
        id: 2,
      };

      const req = new NextRequest('http://localhost:3000/api/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${keyRaw}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(body),
      });

      const res = await POST(req);
      const data = await readJsonRpc(res);

      expect(spyExecute).not.toHaveBeenCalled();
      expect(data.result?.isError).toBe(true);
      expect(data.result?.content?.[0]?.text).toMatch(/AMOUNT_OVER_CAP/);
    });

    it('intel.onramp.prepare over the cap is rejected', async () => {
      await setupKeyStore('50');

      const body = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'intel.onramp.prepare',
          arguments: {
            type: 'onramp',
            sourceAsset: 'NGN',
            destinationAsset: 'USDC',
            amount: '51',
            sender: 'payer-ref',
            destination: Keypair.random().publicKey(),
            depositMethod: 'bank_transfer',
          },
        },
        id: 3,
      };

      const req = new NextRequest('http://localhost:3000/api/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${keyRaw}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(body),
      });

      const res = await POST(req);
      const data = await readJsonRpc(res);

      expect(data.result?.isError).toBe(true);
      expect(data.result?.content?.[0]?.text).toMatch(/AMOUNT_OVER_CAP/);
    });
  });

  describe('in-memory / stdio client with env cap', () => {
    it('rejects prepare with amount over the env cap', async () => {
      vi.stubEnv('MCP_MAX_INTENT_AMOUNT', '10');

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const server = await createServer();
      await server.connect(serverTransport);

      const client = new Client({ name: 'test-client', version: '1.0.0' });
      await client.connect(clientTransport);

      const result = await client.callTool({
        name: 'intel.offramp.prepare',
        arguments: {
          type: 'offramp',
          sourceAsset: 'USDC',
          destinationAsset: 'NGN',
          amount: '11',
          sender: Keypair.random().publicKey(),
          recipient: 'recipient-123',
        },
      });

      expect(result.isError).toBe(true);
      const content = result.content as Array<{ text?: string }> | undefined;
      expect(content?.[0]?.text).toMatch(/AMOUNT_OVER_CAP/);

      await client.close();
      await server.close();
    });
  });
});
