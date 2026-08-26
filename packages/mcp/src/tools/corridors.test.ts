import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCorridorsTool } from './corridors.js';
import { VISIBLE_CORRIDORS } from '../../../../constants/anchors.js';

test('intel.corridors lists all visible corridors', async () => {
  let capturedHandler: ((args: unknown) => Promise<any>) | undefined;
  const server = {
    tool: (name: string, _params: unknown, handler: (args: unknown) => Promise<any>) => {
      capturedHandler = handler;
    },
  } as unknown as McpServer;

  registerCorridorsTool(server);

  assert.ok(capturedHandler, 'handler should be registered');

  const result = await capturedHandler!({});
  const text = result.content[0].text as string;
  const corridors = JSON.parse(text) as Array<{ id: string; displayName: string; anchors: string[] }>;

  const visibleIds = new Set(VISIBLE_CORRIDORS as readonly string[]);

  assert.ok(Array.isArray(corridors), 'corridors should be an array');
  assert.equal(corridors.length, visibleIds.size, `should return ${visibleIds.size} corridors (visible corridors)`);

  for (const corridor of corridors) {
    assert.ok(visibleIds.has(corridor.id), `corridor ${corridor.id} should be visible`);
    assert.ok(corridor.displayName.length > 0, 'displayName should not be empty');
    assert.ok(Array.isArray(corridor.anchors), 'anchors should be an array');
  }

  for (const id of visibleIds) {
    assert.ok(corridors.some((c) => c.id === id), `visible corridor ${id} should be present`);
  }
})