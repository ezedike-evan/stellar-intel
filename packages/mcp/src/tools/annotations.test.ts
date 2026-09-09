/**
 * @vitest-environment node
 *
 * Issue #1040 — an agent reading `tools/list` cannot otherwise tell
 * `intel.execute` (submits a transaction) apart from a read tool like
 * `intel.offramp.quote`. Asserts the hints survive a real MCP round-trip
 * so a future edit to server.ts / a tool file cannot drop them silently.
 */
import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../server.js';
import { QUOTE_TOOL_NAME } from './quote.js';
import { PREPARE_TOOL_NAME } from './prepare.js';
import { EXECUTE_TOOL_NAME } from './execute.js';

describe('tool annotations (#1040)', () => {
  it('marks exactly one tool destructive, and hints read vs. write correctly', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = await createServer();
    await server.connect(serverTransport);
    const client = new Client({ name: 'annotations-test-client', version: '1.0.0' });
    await client.connect(clientTransport);

    try {
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((t) => [t.name, t.annotations]));

      expect(byName.get(QUOTE_TOOL_NAME)?.readOnlyHint).toBe(true);
      expect(byName.get(PREPARE_TOOL_NAME)?.readOnlyHint).toBe(true);

      expect(byName.get(EXECUTE_TOOL_NAME)?.destructiveHint).toBe(true);
      expect(byName.get(EXECUTE_TOOL_NAME)?.idempotentHint).toBe(false);
      expect(byName.get(EXECUTE_TOOL_NAME)?.readOnlyHint).not.toBe(true);

      const destructive = tools.filter((t) => t.annotations?.destructiveHint === true);
      expect(destructive.map((t) => t.name)).toEqual([EXECUTE_TOOL_NAME]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
