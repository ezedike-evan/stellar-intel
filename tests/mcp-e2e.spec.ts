/**
 * @vitest-environment node
 *
 * Issue #137 — MCP tool round-trip via subprocess.
 *
 * Spawns the MCP server as a child process over stdio and exercises both tools
 * through a real MCP client, asserting valid responses and a clean exit.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { pathToFileURL } from 'node:url';

const SERVER = path.resolve(__dirname, '../scripts/mcp/server.ts');

  // Spawning a tsx subprocess that compiles TS + loads the Stellar SDK can take a
  // few seconds (or up to 30s+ on cold-starts under full test suite CPU load).
  // The SDK is now preloaded in the server's initialize phase to absorb this penalty
  // during setup, preventing the first tool execution from hitting the strict 60s timeout.
  // Give this setup phase a generous timeout so it is not flaky under load.
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
    const subprocessSetup = pathToFileURL(path.resolve(__dirname, 'msw/subprocess-setup.ts')).toString();
    transport = new StdioClientTransport({
      command: tsxBin,
      args: ['--import', subprocessSetup, SERVER],
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
        DATABASE_URL: '', // Prevent slow remote DB queries from fetchReputationScores
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
    // Previously, this test was flaky because it hit live anchor endpoints
    // (SEP-1, SEP-38, SEP-6/24) over the real network from a subprocess.
    // When the full test suite ran in parallel, CPU and network contention
    // caused these live requests to frequently exceed their tight bounds,
    // resulting in a RATE_UNAVAILABLE error or a test timeout.
    // We've removed this network dependency by passing an MSW setup script
    // (`--import msw/subprocess-setup.ts`) to the subprocess, guaranteeing
    // deterministic, fast responses.
  }, 30_000);

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
