/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ONRAMP_PREPARE_TOOL_NAME, registerOnrampPrepareTool } from './onramp-prepare.js';
import type { OnrampResult } from '@/lib/intent/onramp';

const createOnrampIntent = vi.hoisted(() => vi.fn());
vi.mock('@/lib/intent/onramp', () => ({ createOnrampIntent }));

const DESTINATION = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const INTENT_HASH = 'cd'.repeat(32);

const ARGS = {
  type: 'onramp' as const,
  sourceAsset: 'NGN',
  destinationAsset: 'USDC',
  amount: '150000',
  sender: 'acct-0012345678',
  destination: DESTINATION,
  depositMethod: 'bank_transfer' as const,
};

function routed(unsignedChangeTrustXdr: string | null): OnrampResult {
  return {
    ok: true,
    response: {
      route: {
        anchorId: 'cowrie',
        anchorDomain: 'cowrie.exchange',
        corridorId: 'usdc-ngn',
        asset: `stellar:USDC:${DESTINATION}`,
        estimatedFee: '1',
        estimatedReceived: '93.75',
        indicative: true,
      },
      intentHash: INTENT_HASH,
      handoffUrl: '/onramp?corridor=usdc-ngn&amount=150000&anchor=cowrie',
      unsignedChangeTrustXdr,
    },
  };
}

async function connect() {
  const server = new McpServer({ name: 'onramp-prepare-test', version: '1.0.0' });
  registerOnrampPrepareTool(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'onramp-prepare-test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return { client, server };
}

beforeEach(() => {
  createOnrampIntent.mockReset();
});

describe('intel.onramp.prepare tool', () => {
  it('is registered under the documented tool name', () => {
    expect(ONRAMP_PREPARE_TOOL_NAME).toBe('intel.onramp.prepare');
  });

  it('states that it does not execute and hints read-only', async () => {
    const { client, server } = await connect();
    try {
      const tool = (await client.listTools()).tools.find(
        (t) => t.name === ONRAMP_PREPARE_TOOL_NAME
      )!;

      expect(tool.description).toContain(
        'Does not execute. Returns a handoffUrl the user must open in a browser to complete KYC and the deposit.'
      );
      expect(tool.annotations?.readOnlyHint).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it.each([
    ['null when a trustline exists', null],
    ['present when one is needed', 'AAAAAgAAAAA='],
  ])('returns a handoffUrl and an XDR that is %s', async (_label, xdr) => {
    createOnrampIntent.mockResolvedValue(routed(xdr));
    const { client, server } = await connect();
    try {
      const result = await client.callTool({ name: ONRAMP_PREPARE_TOOL_NAME, arguments: ARGS });

      expect(result.isError).toBeFalsy();
      const content = result.structuredContent as {
        handoffUrl: string;
        unsignedChangeTrustXdr: string | null;
        unsignedEnvelope: { intentHash: string };
      };
      expect(new URL(content.handoffUrl).pathname).toBe('/onramp');
      expect(content.unsignedChangeTrustXdr).toBe(xdr);
      expect(content.unsignedEnvelope.intentHash).toBe(INTENT_HASH);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('maps ACCOUNT_NOT_FOUND to an error result', async () => {
    createOnrampIntent.mockResolvedValue({
      ok: false,
      code: 'ACCOUNT_NOT_FOUND',
      message: 'The destination account does not exist on Stellar.',
      status: 422,
    });
    const { client, server } = await connect();
    try {
      const result = await client.callTool({ name: ONRAMP_PREPARE_TOOL_NAME, arguments: ARGS });

      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('ACCOUNT_NOT_FOUND');
    } finally {
      await client.close();
      await server.close();
    }
  });
});
