/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ONRAMP_QUOTE_TOOL_NAME, registerOnrampQuoteTool } from './onramp-quote.js';
import type { DepositRate } from '@/types';

const fetchDepositRates = vi.hoisted(() => vi.fn());
vi.mock('@/lib/stellar/deposit-rates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stellar/deposit-rates')>();
  return { ...actual, fetchDepositRates };
});

const USDC = 'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

const ROW: DepositRate = {
  anchorId: 'cowrie',
  anchorName: 'Cowrie',
  corridorId: 'usdc-ngn',
  asset: USDC,
  fiatAmount: 150000,
  fee: 1,
  feeType: 'flat',
  exchangeRate: 0.000625,
  totalReceived: 93.75,
  source: 'sep24-fee',
  updatedAt: new Date('2026-10-25T08:00:00.000Z'),
};

/** Registers only this tool on a bare server, so the test does not pay for the full registry. */
async function connect() {
  const server = new McpServer({ name: 'onramp-quote-test', version: '1.0.0' });
  registerOnrampQuoteTool(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'onramp-quote-test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return { client, server };
}

beforeEach(() => {
  fetchDepositRates.mockReset();
});

describe('intel.onramp.quote tool', () => {
  it('is registered under the documented tool name', () => {
    expect(ONRAMP_QUOTE_TOOL_NAME).toBe('intel.onramp.quote');
  });

  it('describes the result as an indicative estimate and hints read-only', async () => {
    const { client, server } = await connect();
    try {
      const tool = (await client.listTools()).tools.find((t) => t.name === ONRAMP_QUOTE_TOOL_NAME)!;

      expect(tool.description).toMatch(/indicative estimate/i);
      expect(tool.annotations?.readOnlyHint).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('returns structured content marked indicative', async () => {
    fetchDepositRates.mockResolvedValue({
      corridorId: 'usdc-ngn',
      direction: 'deposit',
      rates: [ROW],
      bestRateId: 'cowrie',
      errors: [],
    });
    const { client, server } = await connect();
    try {
      const result = await client.callTool({
        name: ONRAMP_QUOTE_TOOL_NAME,
        arguments: { sourceAsset: 'NGN', destinationAsset: 'USDC', amount: '150000' },
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        anchor: 'cowrie',
        asset: USDC,
        estimatedReceived: '93.75',
        fee: '1',
        indicative: true,
        expiresAt: expect.any(String),
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('returns an error result with the NO_ROUTE code for an unserved pair', async () => {
    const { client, server } = await connect();
    try {
      const result = await client.callTool({
        name: ONRAMP_QUOTE_TOOL_NAME,
        arguments: { sourceAsset: 'XXX', destinationAsset: 'USDC', amount: '100' },
      });

      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('NO_ROUTE');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('returns an error result with RATE_UNAVAILABLE when no anchor can price it', async () => {
    fetchDepositRates.mockResolvedValue({
      corridorId: 'usdc-ngn',
      direction: 'deposit',
      rates: [],
      bestRateId: '',
      errors: [{ anchorId: 'cowrie', anchorName: 'Cowrie', reason: 'down' }],
    });
    const { client, server } = await connect();
    try {
      const result = await client.callTool({
        name: ONRAMP_QUOTE_TOOL_NAME,
        arguments: { sourceAsset: 'NGN', destinationAsset: 'USDC', amount: '100' },
      });

      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('RATE_UNAVAILABLE');
    } finally {
      await client.close();
      await server.close();
    }
  });
});
