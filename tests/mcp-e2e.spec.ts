/**
 * @vitest-environment node
 *
 * Issue #137 — MCP tool round-trip via subprocess.
 *
 * Spawns the MCP server as a child process over stdio and exercises both tools
 * through a real MCP client, asserting valid responses and a clean exit.
 *
 * Scope (#1052): this file proves the subprocess path — that a tsx subprocess
 * boots and speaks stdio. The subprocess runs with MSW
 * (tests/msw/subprocess-setup.ts) and makes no real network calls: anything
 * that is not stubbed there fails the request instead of reaching an anchor.
 * It is deliberately no longer the place the tool contracts are pinned, so
 * assertions here stay strict rather than being loosened for a busy CI.
 *
 * The contracts themselves — arguments in, structuredContent out, and the error
 * text an agent reads — are covered deterministically with the network
 * unplugged in tests/mcp-tools.spec.ts, and the declared tool surface in
 * tests/mcp-tool-registry.spec.ts. Put new contract assertions there; add to
 * this file only when the thing under test is the subprocess itself.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { pathToFileURL } from 'node:url';
import { Keypair } from '@stellar/stellar-sdk';

// Any valid public key works as the sender: prepare reads its account from a stubbed Horizon.
const SENDER = Keypair.random().publicKey();

// The server has no built-in payout accounts; routing needs a verified one in
// ANCHOR_PAYMENT_ACCOUNTS. A throwaway key stands in for cowrie's here.
const ANCHOR_PAYMENT_ACCOUNTS = JSON.stringify({ cowrie: Keypair.random().publicKey() });

const SERVER = path.resolve(__dirname, '../scripts/mcp/server.ts');

// Spawning a tsx subprocess that compiles TS + loads the Stellar SDK is the one
// slow step. The SDK is preloaded in the server's initialize phase to absorb
// that cost during setup, so the tool calls themselves run under the project's
// default test timeout. A hang here should fail fast, not wait a minute.
const STARTUP_TIMEOUT = 20_000;

// Resolve a tsx loader so the TypeScript server can run as a subprocess.
const tsxBin = path.resolve(
  __dirname,
  '../node_modules/.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
);

describe('MCP server round-trip via subprocess (#137)', () => {
  let transport: StdioClientTransport;
  let client: Client;

  beforeAll(async () => {
    const subprocessSetup = pathToFileURL(
      path.resolve(__dirname, 'msw/subprocess-setup.ts')
    ).toString();
    transport = new StdioClientTransport({
      command: tsxBin,
      args: ['--import', subprocessSetup, SERVER],
      env: {
        ...process.env,
        DATABASE_URL: '', // Prevent slow remote DB queries from fetchReputationScores
        ANCHOR_PAYMENT_ACCOUNTS,
      },
    });
    client = new Client({ name: 'e2e-test-client', version: '1.0.0' });
    await client.connect(transport);
  }, STARTUP_TIMEOUT);

  afterAll(async () => {
    // Closing the client tears down the transport and the child process,
    // letting the test process exit cleanly.
    await client?.close();
  });

  it('lists all three tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain('intel.offramp.quote');
    expect(names).toContain('intel.offramp.prepare');
    expect(names).toContain('intel.execute');
  });

  it('intel.offramp.quote returns a valid quote', async () => {
    // MSW serves cowrie's SEP-6/38 endpoints, so the quote is deterministic:
    // an error here means the stubs or the routing broke, not that an anchor
    // was down, and it must fail the test.
    const result = await client.callTool({
      name: 'intel.offramp.quote',
      arguments: { from: 'NGNT', to: 'NGN', amount: '100' },
    });
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    const structured = result.structuredContent as {
      anchor: string;
      quoteId: string;
      netReceived: string;
      expiresAt: string;
      source: string;
      indicative: boolean;
    };
    expect(structured.anchor).toBe('cowrie');
    expect(typeof structured.indicative).toBe('boolean');
    expect(structured.indicative).toBe(structured.source !== 'sep38');
    expect(structured.quoteId).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(structured.netReceived)).toBeGreaterThan(0);
    expect(new Date(structured.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('intel.offramp.prepare returns an unsigned envelope + unsigned tx', async () => {
    const result = await client.callTool({
      name: 'intel.offramp.prepare',
      arguments: {
        type: 'offramp',
        sourceAsset: 'NGNT',
        destinationAsset: 'NGN',
        amount: '100',
        sender: SENDER,
        recipient: 'recipient-123',
      },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      unsignedEnvelope: { intent: unknown; intentHash: string };
      unsignedTx: string;
    };
    expect(structured.unsignedEnvelope.intentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof structured.unsignedTx).toBe('string');
    expect(structured.unsignedTx.length).toBeGreaterThan(0);
  });

  it('intel.execute rejects an invalid signature without crashing the server', async () => {
    // No live Horizon submission here — that needs a funded mainnet account and
    // isn't appropriate for CI. This exercises the tool's full request/response
    // wiring through a real subprocess and asserts the pre-submission signature
    // check rejects a bogus signature, matching the unit coverage in
    // tests/mcp-offramp.spec.ts (#819).
    const prepared = await client.callTool({
      name: 'intel.offramp.prepare',
      arguments: {
        type: 'offramp',
        sourceAsset: 'NGNT',
        destinationAsset: 'NGN',
        amount: '10',
        sender: SENDER,
        recipient: 'recipient-123',
      },
    });
    expect(prepared.isError).toBeFalsy();
    const { unsignedEnvelope, unsignedTx } = prepared.structuredContent as {
      unsignedEnvelope: { intent: unknown; intentHash: string };
      unsignedTx: string;
    };

    const result = await client.callTool({
      name: 'intel.execute',
      arguments: {
        unsignedEnvelope,
        signature: Buffer.from('not-a-real-signature').toString('base64'),
        signedTx: unsignedTx,
      },
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toMatch(/^SIGNATURE_INVALID:/);
  });

  it('surfaces a tool error for an unknown corridor without crashing the server', async () => {
    const result = await client.callTool({
      name: 'intel.offramp.quote',
      arguments: { from: 'USDC', to: 'ZZZ', amount: '10' },
    });
    expect(result.isError).toBe(true);
    // Server is still alive — a subsequent call still works. Uses `prepare`
    // (no live network dependency) rather than `quote` so this assertion
    // isn't coupled to a third-party anchor's rate-quoting being up.
    const ok = await client.callTool({
      name: 'intel.offramp.prepare',
      arguments: {
        type: 'offramp',
        sourceAsset: 'NGNT',
        destinationAsset: 'NGN',
        amount: '10',
        sender: SENDER,
        recipient: 'recipient-123',
      },
    });
    expect(ok.isError).toBeFalsy();
  });
});
