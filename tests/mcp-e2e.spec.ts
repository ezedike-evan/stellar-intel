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
    });
    client = new Client({ name: 'e2e-test-client', version: '1.0.0' });
    await client.connect(transport);
  }, STARTUP_TIMEOUT);

  afterAll(async () => {
    // Closing the client tears down the transport and the child process,
    // letting the test process exit cleanly.
    await client?.close();
  });

  it('lists both off-ramp tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain('intel.offramp.quote');
    expect(names).toContain('intel.offramp.prepare');
  });

  it('intel.offramp.quote returns a valid quote', async () => {
    const result = await client.callTool({
      name: 'intel.offramp.quote',
      arguments: { from: 'USDC', to: 'NGN', amount: '100' },
    });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      anchor: string;
      quoteId: string;
      netReceived: string;
      expiresAt: string;
    };
    expect(structured.anchor).toBe('cowrie');
    expect(structured.quoteId).toMatch(/^[0-9a-f]{64}$/);
    expect(structured.netReceived).toBe('156800');
    expect(new Date(structured.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

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

  it('surfaces a tool error for an unknown corridor without crashing the server', async () => {
    const result = await client.callTool({
      name: 'intel.offramp.quote',
      arguments: { from: 'USDC', to: 'ZZZ', amount: '10' },
    });
    expect(result.isError).toBe(true);
    // Server is still alive — a subsequent good call still works.
    const ok = await client.callTool({
      name: 'intel.offramp.quote',
      arguments: { from: 'USDC', to: 'KES', amount: '50' },
    });
    expect(ok.isError).toBeFalsy();
  });
});
