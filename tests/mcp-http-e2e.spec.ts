/**
 * @vitest-environment node
 *
 * Issue #1049 — streamable HTTP transport alongside stdio.
 *
 * Starts the MCP server in-process over streamable HTTP and exercises it
 * through a real MCP client, asserting the same tool set that the stdio
 * transport serves (#137) is reachable over HTTP too.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createServer } from '../packages/mcp/src/server.js';
import { startStreamableHttpServer } from '../packages/mcp/src/transports/streamable-http.js';
import type { StreamableHttpHandle } from '../packages/mcp/src/transports/streamable-http.js';

describe('MCP server round-trip over streamable HTTP (#1049)', () => {
  let handle: StreamableHttpHandle;
  let transport: StreamableHTTPClientTransport;
  let client: Client;

  beforeAll(async () => {
    handle = await startStreamableHttpServer({ host: '127.0.0.1', port: 0 });
    transport = new StreamableHTTPClientTransport(new URL(handle.url));
    client = new Client({ name: 'http-e2e-test-client', version: '1.0.0' });
    await client.connect(transport as Transport);
  });

  afterAll(async () => {
    await client?.close();
    await handle?.close();
  });

  it('lists the same tools as the in-process server', async () => {
    // Compared against a freshly built server rather than a hardcoded list, so
    // that registering a new tool does not require editing this expectation —
    // the point is that HTTP serves the same registry, not which tools exist.
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const inProcess = await createServer();
    await inProcess.connect(serverSide);
    const reference = new Client({ name: 'in-process-reference', version: '1.0.0' });
    await reference.connect(clientSide);

    try {
      const expected = (await reference.listTools()).tools.map((t) => t.name).sort();
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(expected);
      expect(names.length).toBeGreaterThan(0);
    } finally {
      await reference.close();
      await inProcess.close();
    }
  });

  it('intel.offramp.prepare returns an unsigned envelope + unsigned tx over HTTP', async () => {
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
});
