import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { fetchAnchorSla, ANCHOR_SLA_TOOL_NAME } from '@/lib/mcp/tools/anchor-sla';
import type { ExecutionSlaReport } from '@/lib/reputation/execution-sla';
import { createServer } from '@/lib/mcp/server';

const mockReport: ExecutionSlaReport = {
  anchorId: 'moneygram',
  windowDays: 30,
  computedAt: '2026-06-04T12:00:00.000Z',
  thresholds: { p95Ms: 900_000, p99Ms: 3_600_000 },
  overall: {
    sla: {
      state: 'ok',
      anchorId: 'moneygram',
      corridor: null,
      windowDays: 30,
      computedAt: '2026-06-04T12:00:00.000Z',
      sampleSize: 50,
      terminalTxCount: 50,
      p50Ms: 60_000,
      p95Ms: 120_000,
      p99Ms: 300_000,
    },
    breach: { status: 'within', breaches: [] },
  },
  corridors: [
    {
      corridor: 'usdc-ngn',
      sla: {
        state: 'ok',
        anchorId: 'moneygram',
        corridor: 'usdc-ngn',
        windowDays: 30,
        computedAt: '2026-06-04T12:00:00.000Z',
        sampleSize: 50,
        terminalTxCount: 50,
        p50Ms: 60_000,
        p95Ms: 120_000,
        p99Ms: 300_000,
      },
      breach: { status: 'within', breaches: [] },
    },
  ],
  history: Array.from({ length: 30 }, (_, i) => ({
    day: `2026-05-${String(i + 1).padStart(2, '0')}`,
    p95Ms: 120_000,
    sampleSize: 5,
  })),
};

describe('intel.anchor.sla MCP tool (#2149)', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetchAnchorSla calls http://localhost:3000/api/reputation/moneygram/sla', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockReport,
    });

    const res = await fetchAnchorSla('moneygram');
    expect(res.anchorId).toBe('moneygram');
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/reputation/moneygram/sla', {
      headers: { Accept: 'application/json' },
    });
  });

  it('with corridor query param, URL ends with ?corridor=usdc-ngn and encodes anchor with space', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockReport,
    });

    await fetchAnchorSla('anchor name', 'usdc-ngn');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/reputation/anchor%20name/sla?corridor=usdc-ngn',
      {
        headers: { Accept: 'application/json' },
      }
    );
  });

  it('rejects with error containing 404 when response is 404', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });

    await expect(fetchAnchorSla('unknown-anchor')).rejects.toThrow(/404/);
  });

  it('rejects when response body is missing overall field', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ anchorId: 'moneygram' }),
    });

    await expect(fetchAnchorSla('moneygram')).rejects.toThrow();
  });

  it('server integration via InMemoryTransport', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = await createServer();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);

    try {
      // listTools shows intel.anchor.sla with annotations.readOnlyHint === true
      const { tools } = await client.listTools();
      const slaTool = tools.find((t) => t.name === ANCHOR_SLA_TOOL_NAME);
      expect(slaTool).toBeDefined();
      expect(slaTool?.annotations?.readOnlyHint).toBe(true);

      // callTool with OK body returns structuredContent.anchorId === 'moneygram'
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockReport,
      });

      const okCall = await client.callTool({
        name: ANCHOR_SLA_TOOL_NAME,
        arguments: { anchor: 'moneygram' },
      });

      expect(okCall.isError).toBeFalsy();
      expect((okCall.structuredContent as { anchorId: string })?.anchorId).toBe('moneygram');

      // callTool with 500 error returns isError: true
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const errCall = await client.callTool({
        name: ANCHOR_SLA_TOOL_NAME,
        arguments: { anchor: 'moneygram' },
      });

      expect(errCall.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
