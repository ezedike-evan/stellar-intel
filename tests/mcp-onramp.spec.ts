/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServer } from '@/lib/mcp/server';
import { getOnrampQuote, prepareOnrampIntent, OnrampToolError } from '@/lib/mcp/onramp';
import { McpToolError, fromOnrampError } from '@/lib/mcp/errors';
import type { OnrampResult } from '@/lib/intent/onramp';
import type { DepositRate, DepositRateComparison } from '@/types';
import { InvalidDepositAmountError, NoDepositRateError } from '@/lib/stellar/deposit-rates';

const fetchDepositRates = vi.hoisted(() => vi.fn());
vi.mock('@/lib/stellar/deposit-rates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stellar/deposit-rates')>();
  return { ...actual, fetchDepositRates };
});

const createOnrampIntent = vi.hoisted(() => vi.fn());
vi.mock('@/lib/intent/onramp', () => ({ createOnrampIntent }));

const USDC = 'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const DESTINATION = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

function rate(over: Partial<DepositRate> = {}): DepositRate {
  return {
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
    updatedAt: new Date('2026-10-24T00:00:00.000Z'),
    ...over,
  };
}

function comparison(
  rates: DepositRate[],
  errors: DepositRateComparison['errors'] = []
): DepositRateComparison {
  return {
    corridorId: 'usdc-ngn',
    direction: 'deposit',
    rates,
    bestRateId: rates[0]?.anchorId ?? '',
    errors,
  };
}

const intentInput = {
  type: 'onramp' as const,
  sourceAsset: 'NGN',
  destinationAsset: 'USDC',
  amount: '150000',
  sender: 'acct-0012345678',
  destination: DESTINATION,
  depositMethod: 'bank_transfer' as const,
};

const INTENT_HASH = 'ab'.repeat(32);
const XDR = 'AAAAAgAAAAA=';

function routed(over: Partial<{ unsignedChangeTrustXdr: string | null }> = {}): OnrampResult {
  return {
    ok: true,
    response: {
      route: {
        anchorId: 'cowrie',
        anchorDomain: 'cowrie.exchange',
        corridorId: 'usdc-ngn',
        asset: USDC,
        estimatedFee: '1',
        estimatedReceived: '93.75',
        indicative: true,
      },
      intentHash: INTENT_HASH,
      handoffUrl: '/onramp?corridor=usdc-ngn&amount=150000&anchor=cowrie',
      unsignedChangeTrustXdr: null,
      ...over,
    },
  };
}

beforeEach(() => {
  fetchDepositRates.mockReset();
  createOnrampIntent.mockReset();
  createOnrampIntent.mockResolvedValue(routed());
});

describe('getOnrampQuote', () => {
  it('returns the best priced row with alternatives, as indicative', async () => {
    fetchDepositRates.mockResolvedValue(
      comparison([
        rate(),
        rate({
          anchorId: 'zeam',
          anchorName: 'Zeam',
          totalReceived: 92.5,
          exchangeRate: 0.0006167,
        }),
      ])
    );

    const quote = await getOnrampQuote(
      { sourceAsset: 'NGN', destinationAsset: 'USDC', amount: '150000' },
      new Date('2026-10-25T08:00:00.000Z')
    );

    expect(fetchDepositRates).toHaveBeenCalledWith('usdc-ngn', '150000');
    expect(quote).toMatchObject({
      anchor: 'cowrie',
      corridorId: 'usdc-ngn',
      fiatAmount: '150000',
      estimatedReceived: '93.75',
      exchangeRate: '0.000625',
      indicative: true,
      source: 'sep24-fee',
      fee: '1',
      expiresAt: '2026-10-25T08:00:15.000Z',
    });
    expect(quote.alternatives.map((a) => a.anchor)).toEqual(['zeam']);
  });

  it('reports a null fee when the anchor publishes none', async () => {
    fetchDepositRates.mockResolvedValue(comparison([rate({ fee: null })]));

    const quote = await getOnrampQuote({
      sourceAsset: 'NGN',
      destinationAsset: 'USDC',
      amount: '150000',
    });

    expect(quote.fee).toBeNull();
  });

  it('restricts the quote to one asset when asked', async () => {
    fetchDepositRates.mockResolvedValue(comparison([rate()]));

    await getOnrampQuote({
      sourceAsset: 'NGN',
      destinationAsset: 'USDC',
      amount: '150000',
      asset: USDC,
    });

    expect(fetchDepositRates).toHaveBeenCalledWith('usdc-ngn', '150000', { asset: USDC });
  });

  it('rejects a malformed asset identifier', async () => {
    await expect(
      getOnrampQuote({ sourceAsset: 'NGN', destinationAsset: 'USDC', amount: '1', asset: 'USDC' })
    ).rejects.toBeInstanceOf(McpToolError);
    expect(fetchDepositRates).not.toHaveBeenCalled();
  });

  it('skips unpriced rows and fails only when none is priced', async () => {
    fetchDepositRates.mockResolvedValue(
      comparison(
        [rate({ exchangeRate: null, totalReceived: null, source: 'unavailable' })],
        [{ anchorId: 'cowrie', anchorName: 'Cowrie', reason: 'no transfer server' }]
      )
    );

    await expect(
      getOnrampQuote({ sourceAsset: 'NGN', destinationAsset: 'USDC', amount: '100' })
    ).rejects.toMatchObject({ name: 'OnrampToolError', code: 'RATE_UNAVAILABLE' });
  });

  it('rejects a pair no corridor serves without calling any anchor', async () => {
    await expect(
      getOnrampQuote({ sourceAsset: 'XXX', destinationAsset: 'USDC', amount: '100' })
    ).rejects.toMatchObject({ name: 'OnrampToolError', code: 'NO_ROUTE' });
    expect(fetchDepositRates).not.toHaveBeenCalled();
  });

  it.each(['0', '-5', 'abc', '1e3'])('rejects amount %s', async (amount) => {
    await expect(
      getOnrampQuote({ sourceAsset: 'NGN', destinationAsset: 'USDC', amount })
    ).rejects.toBeInstanceOf(McpToolError);
    expect(fetchDepositRates).not.toHaveBeenCalled();
  });

  it('reports a missing reference price as RATE_UNAVAILABLE', async () => {
    fetchDepositRates.mockRejectedValue(new NoDepositRateError('SDEX book empty'));

    await expect(
      getOnrampQuote({ sourceAsset: 'NGN', destinationAsset: 'USDC', amount: '100' })
    ).rejects.toMatchObject({ name: 'OnrampToolError', code: 'RATE_UNAVAILABLE' });
  });

  it('maps an invalid amount from the engine to BAD_INPUT', async () => {
    fetchDepositRates.mockRejectedValue(new InvalidDepositAmountError('bad amount'));

    await expect(
      getOnrampQuote({ sourceAsset: 'NGN', destinationAsset: 'USDC', amount: '100' })
    ).rejects.toMatchObject({
      category: 'BAD_INPUT',
    });
  });
});

describe('prepareOnrampIntent', () => {
  it('returns the unsigned intent, its hash and an absolute handoff URL', async () => {
    const result = await prepareOnrampIntent(intentInput);

    expect(createOnrampIntent).toHaveBeenCalledWith(intentInput, undefined);
    expect(result.unsignedEnvelope.intent).toEqual(intentInput);
    expect(result.unsignedEnvelope.intentHash).toBe(INTENT_HASH);
    expect(result.corridorId).toBe('usdc-ngn');
    expect(result.unsignedChangeTrustXdr).toBeNull();

    const url = new URL(result.handoffUrl);
    expect(url.origin).toBe('https://stellar-intel.vercel.app');
    expect(url.pathname).toBe('/onramp');
    expect(url.searchParams.get('corridor')).toBe('usdc-ngn');
    expect(url.searchParams.get('amount')).toBe('150000');
    expect(url.searchParams.get('anchor')).toBe('cowrie');
  });

  it('says an agent cannot complete the deposit', async () => {
    const result = await prepareOnrampIntent(intentInput);
    expect(result.note).toBe(
      'Open handoffUrl in a browser to complete KYC and the deposit. Agents cannot complete this step.'
    );
  });

  it('passes the unsigned changeTrust XDR through', async () => {
    createOnrampIntent.mockResolvedValue(routed({ unsignedChangeTrustXdr: XDR }));

    const result = await prepareOnrampIntent(intentInput);

    expect(result.unsignedChangeTrustXdr).toBe(XDR);
  });

  it.each([
    ['NO_ROUTE', 404],
    ['RATE_UNAVAILABLE', 503],
    ['ACCOUNT_NOT_FOUND', 422],
    ['TX_BUILD_FAILED', 500],
  ] as const)('raises %s as an OnrampToolError', async (code, status) => {
    createOnrampIntent.mockResolvedValue({ ok: false, code, message: 'nope', status });

    await expect(prepareOnrampIntent(intentInput)).rejects.toMatchObject({
      name: 'OnrampToolError',
      code,
      message: 'nope',
    });
  });

  it('treats a failed wallet check as a transient upstream error', async () => {
    createOnrampIntent.mockResolvedValue({
      ok: false,
      code: 'PREFLIGHT_FAILED',
      message: 'horizon down',
      status: 502,
    });

    await expect(prepareOnrampIntent(intentInput)).rejects.toMatchObject({
      category: 'UPSTREAM_TIMEOUT',
    });
  });

  it.each([
    ['a destination that is not a Stellar key', { destination: 'nope' }],
    ['a zero amount', { amount: '0' }],
    ['a memo without a memoType', { memo: 'abc' }],
    ['an unknown deposit method', { depositMethod: 'crypto' }],
  ])('rejects %s as BAD_INPUT before resolving anything', async (_label, over) => {
    await expect(prepareOnrampIntent({ ...intentInput, ...over })).rejects.toMatchObject({
      category: 'BAD_INPUT',
    });
    expect(createOnrampIntent).not.toHaveBeenCalled();
  });
});

describe('fromOnrampError', () => {
  it.each([
    ['NO_ROUTE', 'BAD_INPUT'],
    ['ACCOUNT_NOT_FOUND', 'BAD_INPUT'],
    ['RATE_UNAVAILABLE', 'ANCHOR_UNAVAILABLE'],
    ['TX_BUILD_FAILED', 'UPSTREAM_TIMEOUT'],
  ] as const)('maps %s to %s and keeps the code', (code, category) => {
    const mapped = fromOnrampError(new OnrampToolError('msg', code));

    expect(mapped).toBeInstanceOf(McpToolError);
    expect(mapped).toMatchObject({ category, code, message: 'msg' });
  });
});

describe('on-ramp tools over MCP', () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = await createServer();
    await server.connect(serverTransport);
    client = new Client({ name: 'onramp-test-client', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client?.close();
    await server?.close();
  });

  it('lists quote and prepare, and no execute for the on-ramp', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);

    expect(names).toContain('intel.onramp.quote');
    expect(names).toContain('intel.onramp.prepare');
    expect(names).not.toContain('intel.onramp.execute');
  });

  it('intel.onramp.quote returns structured content', async () => {
    fetchDepositRates.mockResolvedValue(comparison([rate()]));

    const result = await client.callTool({
      name: 'intel.onramp.quote',
      arguments: { sourceAsset: 'NGN', destinationAsset: 'USDC', amount: '150000' },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      anchor: 'cowrie',
      indicative: true,
      fee: '1',
      expiresAt: expect.any(String),
    });
  });

  it('intel.onramp.quote reports a bad corridor as a tool error', async () => {
    const result = await client.callTool({
      name: 'intel.onramp.quote',
      arguments: { sourceAsset: 'XXX', destinationAsset: 'USDC', amount: '100' },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('NO_ROUTE');
  });

  it('intel.onramp.prepare reports a missing destination account as a tool error', async () => {
    createOnrampIntent.mockResolvedValue({
      ok: false,
      code: 'ACCOUNT_NOT_FOUND',
      message: 'fund it first',
      status: 422,
    });

    const result = await client.callTool({ name: 'intel.onramp.prepare', arguments: intentInput });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('ACCOUNT_NOT_FOUND');
  });

  it('intel.onramp.prepare returns an unsigned envelope', async () => {
    const result = await client.callTool({
      name: 'intel.onramp.prepare',
      arguments: intentInput,
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      corridorId: 'usdc-ngn',
      unsignedChangeTrustXdr: null,
      unsignedEnvelope: { intentHash: INTENT_HASH },
    });
  });
});
