import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { getAnchorHealthLedger } from '@/lib/stellar/anchors';
import { createServer } from '../server.js';
import {
  ANCHOR_HEALTH_RESOURCE_MIME_TYPE,
  ANCHOR_HEALTH_RESOURCE_NAME,
  ANCHOR_HEALTH_RESOURCE_URI,
} from './anchor-health.js';

/**
 * Driven through a real client over an in-memory transport rather than by
 * calling the read callback directly: the acceptance criterion is about what
 * `resources/list` and `resources/read` return over the wire, and a direct call
 * would pass even if the resource were never registered on the server.
 */
/** Narrow a resource content block to its text, failing loudly on a blob. */
function textOf(content: { text?: unknown; blob?: unknown }): string {
  expect(typeof content.text).toBe('string');
  return content.text as string;
}

async function connectedClient(): Promise<Client> {
  const server = await createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe('anchor-health resource', () => {
  it('is advertised by resources/list with a stable URI and a JSON mime type', async () => {
    const client = await connectedClient();

    const { resources } = await client.listResources();
    const entry = resources.find((r) => r.uri === ANCHOR_HEALTH_RESOURCE_URI);

    expect(entry).toBeDefined();
    expect(entry?.name).toBe(ANCHOR_HEALTH_RESOURCE_NAME);
    expect(entry?.mimeType).toBe(ANCHOR_HEALTH_RESOURCE_MIME_TYPE);

    await client.close();
  });

  it('returns valid JSON from resources/read', async () => {
    const client = await connectedClient();

    const { contents } = await client.readResource({ uri: ANCHOR_HEALTH_RESOURCE_URI });

    expect(contents).toHaveLength(1);
    const [content] = contents;
    expect(content.uri).toBe(ANCHOR_HEALTH_RESOURCE_URI);
    expect(content.mimeType).toBe(ANCHOR_HEALTH_RESOURCE_MIME_TYPE);

    expect(() => JSON.parse(textOf(content))).not.toThrow();

    await client.close();
  });

  it('serves the committed ledger verbatim rather than probing on read', async () => {
    const client = await connectedClient();

    const { contents } = await client.readResource({ uri: ANCHOR_HEALTH_RESOURCE_URI });
    const payload = JSON.parse(textOf(contents[0])) as {
      version: string;
      ledger: ReturnType<typeof getAnchorHealthLedger>;
    };

    // Deep equality against the committed file: any probing, filtering or
    // reshaping on the read path shows up here as a difference.
    expect(payload.ledger).toEqual(getAnchorHealthLedger());
    expect(payload.version).toMatch(/^\d{4}-\d{2}-\d{2}$|^unknown$/);

    await client.close();
  });

  it('is stable across reads — two reads return the same document', async () => {
    const client = await connectedClient();

    const first = await client.readResource({ uri: ANCHOR_HEALTH_RESOURCE_URI });
    const second = await client.readResource({ uri: ANCHOR_HEALTH_RESOURCE_URI });

    expect(textOf(first.contents[0])).toBe(textOf(second.contents[0]));

    await client.close();
  });
});
