/**
 * @vitest-environment node
 *
 * Issue #1052 — the declared half of the MCP tool contract, offline.
 *
 * tests/mcp-tools.spec.ts covers what each handler *does*. This file covers
 * what the server *promises*: the tool names, the arguments each one requires,
 * and the descriptions a model reads to decide whether to call it at all. That
 * declaration is the part an agent consumes before any handler runs, and it is
 * the part a rename or a dropped `outputSchema` breaks silently — a client only
 * finds out at call time, in production.
 *
 * No subprocess and no network: the server is built in-process and driven over
 * an in-memory transport.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServer } from '../packages/mcp/src/server.js';

interface JsonSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
}

interface ListedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
}

/**
 * The published tool surface. Renaming a tool or changing which arguments are
 * mandatory is a breaking change for every agent already wired to it, so it has
 * to be a deliberate edit here rather than a side effect of refactoring.
 */
const EXPECTED_TOOLS: Record<string, { required: string[]; structured: boolean }> = {
  'intel.offramp.quote': { required: ['from', 'to', 'amount'], structured: true },
  'intel.offramp.prepare': {
    required: ['type', 'sourceAsset', 'destinationAsset', 'amount', 'sender', 'recipient'],
    structured: true,
  },
  'intel.execute': { required: ['unsignedEnvelope', 'signature', 'signedTx'], structured: true },
  'intel.anchor.health': { required: ['domain'], structured: true },
  'intel.anchor.reputation': { required: ['anchor'], structured: true },
};

describe('MCP tool registry (#1052)', () => {
  let client: Client;
  let server: McpServer;
  let tools: ListedTool[];

  beforeAll(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = await createServer();
    await server.connect(serverTransport);
    client = new Client({ name: 'registry-test-client', version: '1.0.0' });
    await client.connect(clientTransport);
    tools = (await client.listTools()).tools as unknown as ListedTool[];
  });

  afterAll(async () => {
    await client?.close();
    await server?.close();
  });

  it('publishes exactly the expected tool set', () => {
    expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(EXPECTED_TOOLS).sort());
  });

  it.each(Object.entries(EXPECTED_TOOLS))(
    '%s declares its required arguments',
    (name, expected) => {
      const tool = tools.find((t) => t.name === name);

      expect(tool, `${name} is not registered`).toBeDefined();
      expect(tool!.inputSchema.type).toBe('object');
      expect([...(tool!.inputSchema.required ?? [])].sort()).toEqual([...expected.required].sort());
    }
  );

  it.each(Object.entries(EXPECTED_TOOLS))(
    '%s declares an output schema so results are structured',
    (name, expected) => {
      const tool = tools.find((t) => t.name === name)!;

      // Without an output schema the SDK omits `structuredContent` and every
      // caller is left parsing the text block by hand.
      expect(Boolean(tool.outputSchema)).toBe(expected.structured);
    }
  );

  it('gives every tool a title and a description a model can route on', () => {
    for (const tool of tools) {
      expect(tool.title, `${tool.name} has no title`).toBeTruthy();
      // A one-word description is indistinguishable from no description when a
      // model is choosing between five tools.
      expect(tool.description ?? '', `${tool.name} has no usable description`).toMatch(/\S+\s+\S+/);
    }
  });

  it('documents every argument it accepts', () => {
    for (const tool of tools) {
      const properties = Object.entries(tool.inputSchema.properties ?? {});
      expect(properties.length, `${tool.name} declares no arguments`).toBeGreaterThan(0);

      for (const [argument, schema] of properties) {
        const described = (schema as { description?: string }).description;
        expect(described, `${tool.name}.${argument} has no description`).toBeTruthy();
      }
    }
  });
});
