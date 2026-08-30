/**
 * @vitest-environment node
 *
 * Issue #137 — MCP tool round-trip via subprocess.
 *
 * Spawns the MCP server as a child process over stdio and exercises both tools
 * through a real MCP client, asserting valid responses and a clean exit.
 *
 * Scope (#1052): this file proves the *live* path — that a tsx subprocess boots,
 * speaks stdio, and can reach real anchors. It is deliberately no longer the
 * place the tool contracts are pinned. Spawning a subprocess and calling live
 * anchors is slow and load-sensitive, so any assertion that lives only here is
 * an assertion that gets loosened the next time CI is busy (see the
 * RATE_UNAVAILABLE branch below, which had to accept either outcome).
 *
 * The contracts themselves — arguments in, structuredContent out, and the error
 * text an agent reads — are covered deterministically with the network
 * unplugged in tests/mcp-tools.spec.ts, and the declared tool surface in
 * tests/mcp-tool-registry.spec.ts. Put new contract assertions there; add to
 * this file only when the thing under test is the subprocess or the live anchor
 * itself.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER = path.resolve(__dirname, '../scripts/mcp/server.ts');

// Spawning a tsx subprocess that compiles TS + loads the Stellar SDK can take a
// few seconds, especially when the whole suite runs in parallel. Give this
// file generous timeouts so it is not flaky under load.
const STARTUP_TIMEOUT = 60_000;

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
    transport = new StdioClientTransport({
      command: tsxBin,
      args: [SERVER],
      // Bound the live tiered rate check's worst case (lib/stellar/server-rates.ts
      // defaults to 8s/tier with a retry — up to ~48s across SEP-38/24/6). A
      // real subprocess round-trip doesn't need that much grace to prove the
      // live path works, and a tighter bound keeps this test from being flaky
      // under parallel CI/sandbox load.
      env: {
        ...process.env,
        RATES_SEP38_TIMEOUT_MS: '3000',
        RATES_SEP24_INFO_TIMEOUT_MS: '3000',
        RATES_TOML_TIMEOUT_MS: '3000',
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
    // getQuote now sources a LIVE rate (see lib/mcp/offramp.ts) — it can no
    // longer guarantee a fixed netReceived, and the routed anchor's live
    // quote can legitimately be unavailable at request time (e.g. the anchor
    // currently doesn't advertise SEP-38/24/6 withdraw for this asset). Both
    // outcomes are valid MCP responses; assert the tool is wired correctly in
    // either case rather than pinning a stale static number.
    const result = await client.callTool({
      name: 'intel.offramp.quote',
      arguments: { from: 'USDC', to: 'NGN', amount: '100' },
    });
    if (result.isError) {
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0]?.text).toMatch(/^RATE_UNAVAILABLE:/);
      return;
    }
    const structured = result.structuredContent as {
      anchor: string;
      quoteId: string;
      netReceived: string;
      expiresAt: string;
    };
    expect(structured.anchor).toBe('cowrie');
    expect(structured.quoteId).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(structured.netReceived)).toBeGreaterThan(0);
    expect(new Date(structured.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // A real network round-trip against a live anchor (even with the tighter
    // per-tier timeouts set above) can occasionally run long under heavy
    // parallel test load — give it generous headroom rather than flake.
  }, 90_000);

  it('intel.offramp.prepare returns an unsigned envelope + unsigned tx', async () => {
    const result = await client.callTool({
      name: 'intel.offramp.prepare',
      arguments: {
        type: 'offramp',
        sourceAsset: 'USDC',
        destinationAsset: 'NGN',
        amount: '100',
        sender: 'GAIJ3VXNY7RPPLGVVCLGBK7NPHLL5ZRKATHETOA7M7UPZPAAHEGQQIY2',
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
        sourceAsset: 'USDC',
        destinationAsset: 'NGN',
        amount: '10',
        sender: 'GAIJ3VXNY7RPPLGVVCLGBK7NPHLL5ZRKATHETOA7M7UPZPAAHEGQQIY2',
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
        sourceAsset: 'USDC',
        destinationAsset: 'NGN',
        amount: '10',
        sender: 'GAIJ3VXNY7RPPLGVVCLGBK7NPHLL5ZRKATHETOA7M7UPZPAAHEGQQIY2',
        recipient: 'recipient-123',
      },
    });
    expect(ok.isError).toBeFalsy();
  });
});
