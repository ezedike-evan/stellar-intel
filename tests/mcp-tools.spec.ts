/**
 * @vitest-environment node
 *
 * Issue #1052 — deterministic MCP tool coverage with the network unplugged.
 *
 * Every tool the server registers is exercised here through a real MCP client
 * over an in-memory transport: no subprocess, no anchors, no Horizon, and no
 * `fetch` that can reach the internet. The live round-trip in
 * tests/mcp-e2e.spec.ts still proves the stdio wiring against real anchors, but
 * the tool *contracts* — arguments in, `structuredContent` out, and the error
 * text an agent reads when something is wrong — are covered here, where they
 * run in milliseconds and cannot time out under load.
 *
 * These are handler tests, not library tests. tests/mcp-offramp.spec.ts covers
 * lib/mcp/offramp.ts directly; what this file adds is the layer above it — that
 * each tool is registered, decodes its arguments, and maps a success or a
 * thrown OfframpToolError onto the MCP result shape an agent actually sees.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  stubbedCorridorRates,
  stubFetch,
  expectedNetReceived,
  UNQUOTABLE_AMOUNT,
  HEALTHY_ANCHOR,
  DEGRADED_ANCHOR,
  ANCHOR_REPUTATION,
} from './fixtures/mcp';

// The one network call the off-ramp tools make on their own: a fan-out across
// SEP-38/24/6 endpoints. Stubbed at the module boundary so the handler, the
// routing table and the response mapping are all still the real thing.
const fetchCorridorRates = vi.fn(async (corridorId: string, amount: string) =>
  stubbedCorridorRates(corridorId, amount)
);
vi.mock('@/lib/stellar/server-rates', () => ({
  fetchCorridorRates: (corridorId: string, amount: string) =>
    fetchCorridorRates(corridorId, amount),
}));

// intel.execute submits to Horizon. Only `submitTransaction` is stubbed, so
// Keypair, TransactionBuilder and the signature checks stay real — these tests
// sign with a real key and the handler really verifies it.
const submitTransaction = vi.fn();
vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  return {
    ...actual,
    Horizon: {
      ...actual.Horizon,
      Server: vi.fn().mockImplementation(function MockHorizonServer(this: {
        submitTransaction: typeof submitTransaction;
      }) {
        this.submitTransaction = submitTransaction;
      }),
    },
  };
});

const { Keypair, TransactionBuilder, Networks } = await import('@stellar/stellar-sdk');
const { createServer } = await import('../packages/mcp/src/server.js');

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

/** Text of the first content block — the message an agent reads on failure. */
function textOf(result: ToolResult): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0]?.text ?? '';
}

describe('MCP tool contracts, offline (#1052)', () => {
  let client: Client;
  let server: McpServer;
  const realFetch = globalThis.fetch;

  const SENDER = Keypair.random();

  const PREPARE_ARGS = {
    type: 'offramp',
    sourceAsset: 'USDC',
    destinationAsset: 'NGN',
    amount: '100',
    sender: SENDER.publicKey(),
    recipient: 'recipient-123',
  };

  async function prepare(overrides: Record<string, unknown> = {}): Promise<ToolResult> {
    return client.callTool({
      name: 'intel.offramp.prepare',
      arguments: { ...PREPARE_ARGS, ...overrides },
    });
  }

  beforeAll(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = await createServer();
    await server.connect(serverTransport);
    client = new Client({ name: 'offline-contract-client', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client?.close();
    await server?.close();
    globalThis.fetch = realFetch;
  });

  beforeEach(() => {
    fetchCorridorRates.mockClear();
    submitTransaction.mockReset();
    // Anything not explicitly stubbed throws rather than dialling out.
    globalThis.fetch = stubFetch([
      { urlContains: '/api/v1/anchors/cowrie/health', body: HEALTHY_ANCHOR },
      { urlContains: '/api/v1/anchors/anclap/health', body: DEGRADED_ANCHOR },
      { urlContains: '/api/reputation/cowrie', body: ANCHOR_REPUTATION },
      { urlContains: '/api/reputation/anclap', status: 503, body: 'upstream unavailable' },
    ]);
  });

  // ─── intel.offramp.quote ───────────────────────────────────────────────────

  describe('intel.offramp.quote', () => {
    it('returns the routed anchor, a hashed quote id, the net received and an expiry', async () => {
      const result = await client.callTool({
        name: 'intel.offramp.quote',
        arguments: { from: 'USDC', to: 'NGN', amount: '100' },
      });

      expect(result.isError).toBeFalsy();
      const quote = result.structuredContent as {
        anchor: string;
        quoteId: string;
        netReceived: string;
        expiresAt: string;
      };
      expect(quote.anchor).toBe('cowrie');
      expect(quote.quoteId).toMatch(/^[0-9a-f]{64}$/);
      expect(Number(quote.netReceived)).toBe(expectedNetReceived('usdc-ngn', '100'));
      expect(new Date(quote.expiresAt).getTime()).toBeGreaterThan(Date.now());
      // The text block mirrors the structured payload, so a client that reads
      // only one of the two still sees the same answer.
      expect(JSON.parse(textOf(result))).toEqual(quote);
    });

    it('routes each corridor to its own anchor', async () => {
      const result = await client.callTool({
        name: 'intel.offramp.quote',
        arguments: { from: 'USDC', to: 'KES', amount: '50' },
      });

      const quote = result.structuredContent as { anchor: string; netReceived: string };
      expect(quote.anchor).toBe('flutterwave');
      expect(Number(quote.netReceived)).toBe(expectedNetReceived('usdc-kes', '50'));
    });

    it('is case-insensitive about the corridor', async () => {
      const result = await client.callTool({
        name: 'intel.offramp.quote',
        arguments: { from: 'usdc', to: 'ngn', amount: '100' },
      });

      expect(result.isError).toBeFalsy();
      expect(fetchCorridorRates).toHaveBeenCalledWith('usdc-ngn', '100');
    });

    it('reports NO_ROUTE for a corridor the router does not serve', async () => {
      const result = await client.callTool({
        name: 'intel.offramp.quote',
        arguments: { from: 'USDC', to: 'ZZZ', amount: '10' },
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/^NO_ROUTE: /);
    });

    it('reports RATE_UNAVAILABLE, with the anchor reason, when the anchor cannot be quoted', async () => {
      const result = await client.callTool({
        name: 'intel.offramp.quote',
        arguments: { from: 'USDC', to: 'NGN', amount: UNQUOTABLE_AMOUNT },
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/^RATE_UNAVAILABLE: /);
      // The reason the anchor gave has to survive to the agent, or the agent
      // cannot tell "retry" from "this corridor will never quote".
      expect(textOf(result)).toContain('anchor unreachable');
    });

    it('rejects a malformed amount without reaching the rate source', async () => {
      const result = await client.callTool({
        name: 'intel.offramp.quote',
        arguments: { from: 'USDC', to: 'NGN', amount: 'not-a-number' },
      });

      expect(result.isError).toBe(true);
      expect(fetchCorridorRates).not.toHaveBeenCalled();
    });

    it('rejects a missing argument at the protocol boundary', async () => {
      // Caught by the declared input schema before the handler runs, so the
      // agent is told which argument is missing rather than getting a generic
      // failure out of the routing code.
      const result = await client.callTool({
        name: 'intel.offramp.quote',
        arguments: { from: 'USDC', to: 'NGN' },
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('amount');
      expect(fetchCorridorRates).not.toHaveBeenCalled();
    });
  });

  // ─── intel.offramp.prepare ─────────────────────────────────────────────────

  describe('intel.offramp.prepare', () => {
    it('returns the intent it was given, its canonical hash and an unsigned tx', async () => {
      const result = await prepare();

      expect(result.isError).toBeFalsy();
      const prepared = result.structuredContent as {
        unsignedEnvelope: { intent: Record<string, string>; intentHash: string };
        unsignedTx: string;
      };
      expect(prepared.unsignedEnvelope.intent).toEqual(PREPARE_ARGS);
      expect(prepared.unsignedEnvelope.intentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(prepared.unsignedTx.length).toBeGreaterThan(0);
    });

    it('builds a tx that pays the routed anchor, unsigned, memoed with the intent hash', async () => {
      const result = await prepare();
      const { unsignedEnvelope, unsignedTx } = result.structuredContent as {
        unsignedEnvelope: { intentHash: string };
        unsignedTx: string;
      };

      const tx = TransactionBuilder.fromXDR(unsignedTx, Networks.PUBLIC);
      expect('signatures' in tx ? tx.signatures : null).toHaveLength(0);
      expect('source' in tx ? tx.source : null).toBe(SENDER.publicKey());

      const operations = 'operations' in tx ? tx.operations : [];
      expect(operations).toHaveLength(1);
      expect(operations[0]?.type).toBe('payment');

      // The memo is what ties the on-chain payment back to the intent that
      // authorised it; without it the settlement record is unattributable.
      // stellar-sdk 17 types the hash memo value as Uint8Array rather than Buffer.
      const memo =
        'memo' in tx ? (tx.memo as unknown as { type: string; value: Uint8Array }) : undefined;
      expect(memo?.type).toBe('hash');
      expect(memo && Buffer.from(memo.value).toString('hex')).toBe(unsignedEnvelope.intentHash);
    });

    it('is deterministic — the same intent hashes the same way twice', async () => {
      const hashOf = (r: ToolResult) =>
        (r.structuredContent as { unsignedEnvelope: { intentHash: string } }).unsignedEnvelope
          .intentHash;

      expect(hashOf(await prepare())).toBe(hashOf(await prepare()));
    });

    it('reports NO_ROUTE for a corridor the router does not serve', async () => {
      const result = await prepare({ destinationAsset: 'ZZZ' });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/^NO_ROUTE: /);
    });

    it('rejects a sender that is not a Stellar public key', async () => {
      const result = await prepare({ sender: 'not-a-key' });

      expect(result.isError).toBe(true);
    });

    it('never consults the rate source', async () => {
      await prepare();

      expect(fetchCorridorRates).not.toHaveBeenCalled();
    });
  });

  // ─── intel.execute ─────────────────────────────────────────────────────────

  describe('intel.execute', () => {
    /** Prepares an intent and signs both halves the way an agent's wallet would. */
    async function prepareAndSign(overrides: Record<string, unknown> = {}) {
      const prepared = await prepare(overrides);
      const { unsignedEnvelope, unsignedTx } = prepared.structuredContent as {
        unsignedEnvelope: { intent: Record<string, string>; intentHash: string };
        unsignedTx: string;
      };

      const signature = Buffer.from(
        SENDER.sign(Buffer.from(unsignedEnvelope.intentHash, 'utf8'))
      ).toString('base64');
      const tx = TransactionBuilder.fromXDR(unsignedTx, Networks.PUBLIC);
      tx.sign(SENDER);

      return { unsignedEnvelope, signature, signedTx: tx.toXDR() };
    }

    async function execute(overrides: Record<string, unknown> = {}): Promise<ToolResult> {
      const signed = await prepareAndSign();
      return client.callTool({
        name: 'intel.execute',
        arguments: { ...signed, ...overrides },
      });
    }

    it('submits a correctly signed intent and reports the corridor it settled', async () => {
      submitTransaction.mockResolvedValueOnce({ hash: 'a'.repeat(64), ledger: 51_234_567 });

      const result = await execute();

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({
        status: 'submitted',
        hash: 'a'.repeat(64),
        ledger: 51_234_567,
        corridorId: 'usdc-ngn',
        anchorId: 'cowrie',
      });
      expect(submitTransaction).toHaveBeenCalledTimes(1);
    });

    it('rejects a signature that does not verify, without submitting', async () => {
      const result = await execute({
        signature: Buffer.from('not-a-real-signature').toString('base64'),
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/^SIGNATURE_INVALID: /);
      expect(submitTransaction).not.toHaveBeenCalled();
    });

    it('rejects an envelope whose hash does not match its intent', async () => {
      const signed = await prepareAndSign();

      const result = await client.callTool({
        name: 'intel.execute',
        arguments: {
          ...signed,
          unsignedEnvelope: {
            // The amount an agent signed for is the one thing that must not be
            // swappable after the fact.
            intent: { ...signed.unsignedEnvelope.intent, amount: '1' },
            intentHash: signed.unsignedEnvelope.intentHash,
          },
        },
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/^INTENT_HASH_MISMATCH: /);
      expect(submitTransaction).not.toHaveBeenCalled();
    });

    it('rejects a transaction that carries no signatures', async () => {
      const prepared = await prepare();
      const { unsignedEnvelope, unsignedTx } = prepared.structuredContent as {
        unsignedEnvelope: { intentHash: string };
        unsignedTx: string;
      };

      const result = await client.callTool({
        name: 'intel.execute',
        arguments: {
          unsignedEnvelope,
          signature: Buffer.from(
            SENDER.sign(Buffer.from(unsignedEnvelope.intentHash, 'utf8'))
          ).toString('base64'),
          signedTx: unsignedTx,
        },
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/^UNSIGNED_TX: /);
      expect(submitTransaction).not.toHaveBeenCalled();
    });

    it('rejects a signed tx that is not the one prepared for this intent', async () => {
      // Same sender, same corridor, different amount: the signed intent and the
      // signed transaction have to agree with each other, not merely each be valid.
      const signed = await prepareAndSign();
      const elsewhere = await prepareAndSign({ amount: '25' });

      const result = await client.callTool({
        name: 'intel.execute',
        arguments: { ...signed, signedTx: elsewhere.signedTx },
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/^TX_MISMATCH: /);
      expect(submitTransaction).not.toHaveBeenCalled();
    });

    it('surfaces the Horizon result codes when submission is rejected', async () => {
      submitTransaction.mockRejectedValueOnce({
        response: {
          data: { extras: { result_codes: { transaction: ['tx_insufficient_balance'] } } },
        },
      });

      const result = await execute();

      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/^SUBMIT_FAILED: /);
      // A bare "submission failed" leaves an agent with nothing to act on.
      expect(textOf(result)).toContain('tx_insufficient_balance');
    });
  });

  // ─── intel.anchor.health ───────────────────────────────────────────────────

  describe('intel.anchor.health', () => {
    it('returns the ledger entry for an anchor domain', async () => {
      const result = await client.callTool({
        name: 'intel.anchor.health',
        arguments: { domain: 'cowrie.exchange' },
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual(HEALTHY_ANCHOR);
    });

    it('carries the degraded flag and last error through unchanged', async () => {
      const result = await client.callTool({
        name: 'intel.anchor.health',
        arguments: { domain: 'anclap.com' },
      });

      const health = result.structuredContent as typeof DEGRADED_ANCHOR;
      expect(health.degraded).toBe(true);
      expect(health.consecutiveFailures).toBe(4);
      expect(health.lastError).toBe(DEGRADED_ANCHOR.lastError);
    });

    it('accepts an asset the anchor supports', async () => {
      const result = await client.callTool({
        name: 'intel.anchor.health',
        arguments: { domain: 'cowrie.exchange', asset: 'ngn' },
      });

      expect(result.isError).toBeFalsy();
    });

    it('reports an asset the anchor does not support', async () => {
      const result = await client.callTool({
        name: 'intel.anchor.health',
        arguments: { domain: 'cowrie.exchange', asset: 'JPY' },
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('not supported');
    });

    it('reports an unknown domain rather than guessing at an anchor', async () => {
      const result = await client.callTool({
        name: 'intel.anchor.health',
        arguments: { domain: 'not-an-anchor.example' },
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('No anchor found');
    });
  });

  // ─── intel.anchor.reputation ───────────────────────────────────────────────

  describe('intel.anchor.reputation', () => {
    it('returns every scorecard window', async () => {
      const result = await client.callTool({
        name: 'intel.anchor.reputation',
        arguments: { anchor: 'cowrie' },
      });

      expect(result.isError).toBeFalsy();
      const reputation = result.structuredContent as unknown as typeof ANCHOR_REPUTATION;
      expect(Object.keys(reputation.scorecards).sort()).toEqual(['30', '7', '90']);
      expect(reputation.scorecards[7].fillRate).toBe(0.98);
    });

    it('preserves insufficient_data rather than flattening it into a score', async () => {
      const result = await client.callTool({
        name: 'intel.anchor.reputation',
        arguments: { anchor: 'cowrie' },
      });

      const reputation = result.structuredContent as unknown as typeof ANCHOR_REPUTATION;
      expect(reputation.scorecards[90].state).toBe('insufficient_data');
      expect(reputation.scorecards[90]).not.toHaveProperty('fillRate');
    });

    it('reports an upstream failure with its status', async () => {
      const result = await client.callTool({
        name: 'intel.anchor.reputation',
        arguments: { anchor: 'anclap' },
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('503');
    });
  });
});
