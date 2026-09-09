/**
 * @vitest-environment node
 *
 * Issue #1044 — intel.leaderboard MCP tool.
 *
 * Tests cover:
 * - fetchLeaderboard(): network delegation, corridor filtering, error handling
 * - annotateEntries (via the tool handler): measured flag, standing labels
 * - registerLeaderboardTool(): tool registration wiring and structured output
 * - unmeasured-anchor distinction (n = 0 → "not yet measured")
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LeaderboardResponse, LeaderboardEntry } from '@/app/api/reputation/leaderboard/route';

// ─── Mock global fetch ────────────────────────────────────────────────────────

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    anchor_id: 'cowrie',
    composite: 0.85,
    fill_rate: 0.95,
    settle_p50: 45,
    slippage_p50: 0.01,
    n: 100,
    onChain: null,
    ...overrides,
  };
}

function makeLeaderboardResponse(
  overrides: Partial<LeaderboardResponse> = {}
): LeaderboardResponse {
  return {
    leaderboard: [makeEntry()],
    corridor: null,
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockFetchOk(body: LeaderboardResponse): void {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => body,
  } as Response);
}

function mockFetchError(status: number, text = 'Internal Server Error'): void {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status,
    text: async () => text,
  } as unknown as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── fetchLeaderboard ─────────────────────────────────────────────────────────

describe('fetchLeaderboard', () => {
  it('calls the leaderboard endpoint without corridor param when none given', async () => {
    const { fetchLeaderboard } = await import('@/packages/mcp/src/tools/leaderboard');
    const body = makeLeaderboardResponse();
    mockFetchOk(body);

    await fetchLeaderboard(undefined, 'http://localhost:3000');

    const calledUrl = (fetchMock.mock.calls[0]?.[0] as string) ?? '';
    expect(calledUrl).toBe('http://localhost:3000/api/reputation/leaderboard');
    expect(calledUrl).not.toContain('corridor=');
  });

  it('appends corridor query param when provided', async () => {
    const { fetchLeaderboard } = await import('@/packages/mcp/src/tools/leaderboard');
    const body = makeLeaderboardResponse({ corridor: 'usdc-ngn' });
    mockFetchOk(body);

    await fetchLeaderboard('usdc-ngn', 'http://localhost:3000');

    const calledUrl = (fetchMock.mock.calls[0]?.[0] as string) ?? '';
    expect(calledUrl).toContain('corridor=usdc-ngn');
  });

  it('returns the parsed JSON body on success', async () => {
    const { fetchLeaderboard } = await import('@/packages/mcp/src/tools/leaderboard');
    const body = makeLeaderboardResponse({
      leaderboard: [makeEntry({ anchor_id: 'cowrie', composite: 0.9 })],
      corridor: 'usdc-ngn',
    });
    mockFetchOk(body);

    const result = await fetchLeaderboard('usdc-ngn', 'http://localhost:3000');
    expect(result.corridor).toBe('usdc-ngn');
    expect(result.leaderboard[0]?.anchor_id).toBe('cowrie');
    expect(result.leaderboard[0]?.composite).toBe(0.9);
  });

  it('throws on a non-OK HTTP response', async () => {
    const { fetchLeaderboard } = await import('@/packages/mcp/src/tools/leaderboard');
    mockFetchError(400, 'VALIDATION_ERROR: unknown corridor');

    await expect(fetchLeaderboard('bad-corridor', 'http://localhost:3000')).rejects.toThrow(
      /Leaderboard API error 400/
    );
  });

  it('throws on a 500 server error', async () => {
    const { fetchLeaderboard } = await import('@/packages/mcp/src/tools/leaderboard');
    mockFetchError(500);

    await expect(fetchLeaderboard(undefined, 'http://localhost:3000')).rejects.toThrow(
      /Leaderboard API error 500/
    );
  });

  it('falls back to localhost when NEXT_PUBLIC_APP_URL is unset', async () => {
    const { fetchLeaderboard } = await import('@/packages/mcp/src/tools/leaderboard');
    mockFetchOk(makeLeaderboardResponse());
    const previous = process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;

    try {
      await fetchLeaderboard(undefined);
    } finally {
      if (previous !== undefined) process.env.NEXT_PUBLIC_APP_URL = previous;
    }

    const calledUrl = (fetchMock.mock.calls[0]?.[0] as string) ?? '';
    expect(calledUrl).toContain('http://localhost:3000');
  });

  it('uses NEXT_PUBLIC_APP_URL as the default base URL', async () => {
    const { fetchLeaderboard } = await import('@/packages/mcp/src/tools/leaderboard');
    mockFetchOk(makeLeaderboardResponse());
    const previous = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = 'https://stellar-intel.vercel.app';

    try {
      await fetchLeaderboard(undefined);
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = previous;
    }

    const calledUrl = (fetchMock.mock.calls[0]?.[0] as string) ?? '';
    expect(calledUrl).toContain('stellar-intel.vercel.app');
  });
});

// ─── Annotation (unmeasured-anchor distinction) ───────────────────────────────

describe('annotateEntries via tool handler', () => {
  it('marks an anchor with n > 0 as measured', async () => {
    const { registerLeaderboardTool } = await import('@/packages/mcp/src/tools/leaderboard');

    const body = makeLeaderboardResponse({
      leaderboard: [makeEntry({ n: 50, composite: 0.75 })],
    });
    mockFetchOk(body);

    let capturedResult: unknown;
    const mockServer = {
      registerTool: (
        _name: string,
        _meta: unknown,
        handler: (args: Record<string, unknown>) => Promise<{ structuredContent: unknown }>
      ) => {
        void handler({}).then((r) => {
          capturedResult = r.structuredContent;
        });
      },
    };

    registerLeaderboardTool(mockServer as never);
    // Wait for the async handler
    await new Promise((r) => setTimeout(r, 50));

    const result = capturedResult as {
      leaderboard: Array<{ measured: boolean; standing: string }>;
    };
    expect(result.leaderboard[0]?.measured).toBe(true);
  });

  it('marks an anchor with n = 0 as not measured', async () => {
    const { registerLeaderboardTool } = await import('@/packages/mcp/src/tools/leaderboard');

    const body = makeLeaderboardResponse({
      leaderboard: [makeEntry({ n: 0, composite: 0 })],
    });
    mockFetchOk(body);

    let capturedResult: unknown;
    const mockServer = {
      registerTool: (
        _name: string,
        _meta: unknown,
        handler: (args: Record<string, unknown>) => Promise<{ structuredContent: unknown }>
      ) => {
        void handler({}).then((r) => {
          capturedResult = r.structuredContent;
        });
      },
    };

    registerLeaderboardTool(mockServer as never);
    await new Promise((r) => setTimeout(r, 50));

    const result = capturedResult as {
      leaderboard: Array<{ measured: boolean; standing: string }>;
    };
    expect(result.leaderboard[0]?.measured).toBe(false);
    expect(result.leaderboard[0]?.standing).toBe('not yet measured');
  });

  it('labels a 0.85 composite score as "excellent"', async () => {
    const { registerLeaderboardTool } = await import('@/packages/mcp/src/tools/leaderboard');

    const body = makeLeaderboardResponse({
      leaderboard: [makeEntry({ n: 100, composite: 0.85 })],
    });
    mockFetchOk(body);

    let capturedResult: unknown;
    const mockServer = {
      registerTool: (
        _name: string,
        _meta: unknown,
        handler: (args: Record<string, unknown>) => Promise<{ structuredContent: unknown }>
      ) => {
        void handler({}).then((r) => {
          capturedResult = r.structuredContent;
        });
      },
    };

    registerLeaderboardTool(mockServer as never);
    await new Promise((r) => setTimeout(r, 50));

    const result = capturedResult as {
      leaderboard: Array<{ standing: string }>;
    };
    expect(result.leaderboard[0]?.standing).toBe('excellent');
  });

  it('labels a 0.65 composite score as "good"', async () => {
    const { registerLeaderboardTool } = await import('@/packages/mcp/src/tools/leaderboard');

    const body = makeLeaderboardResponse({
      leaderboard: [makeEntry({ n: 40, composite: 0.65 })],
    });
    mockFetchOk(body);

    let capturedResult: unknown;
    const mockServer = {
      registerTool: (
        _name: string,
        _meta: unknown,
        handler: (args: Record<string, unknown>) => Promise<{ structuredContent: unknown }>
      ) => {
        void handler({}).then((r) => {
          capturedResult = r.structuredContent;
        });
      },
    };

    registerLeaderboardTool(mockServer as never);
    await new Promise((r) => setTimeout(r, 50));

    const result = capturedResult as { leaderboard: Array<{ standing: string }> };
    expect(result.leaderboard[0]?.standing).toBe('good');
  });

  it('labels a 0.45 composite score as "fair"', async () => {
    const { registerLeaderboardTool } = await import('@/packages/mcp/src/tools/leaderboard');

    const body = makeLeaderboardResponse({
      leaderboard: [makeEntry({ n: 20, composite: 0.45 })],
    });
    mockFetchOk(body);

    let capturedResult: unknown;
    const mockServer = {
      registerTool: (
        _name: string,
        _meta: unknown,
        handler: (args: Record<string, unknown>) => Promise<{ structuredContent: unknown }>
      ) => {
        void handler({}).then((r) => {
          capturedResult = r.structuredContent;
        });
      },
    };

    registerLeaderboardTool(mockServer as never);
    await new Promise((r) => setTimeout(r, 50));

    const result = capturedResult as { leaderboard: Array<{ standing: string }> };
    expect(result.leaderboard[0]?.standing).toBe('fair');
  });

  it('labels a 0.2 composite score as "poor"', async () => {
    const { registerLeaderboardTool } = await import('@/packages/mcp/src/tools/leaderboard');

    const body = makeLeaderboardResponse({
      leaderboard: [makeEntry({ n: 10, composite: 0.2 })],
    });
    mockFetchOk(body);

    let capturedResult: unknown;
    const mockServer = {
      registerTool: (
        _name: string,
        _meta: unknown,
        handler: (args: Record<string, unknown>) => Promise<{ structuredContent: unknown }>
      ) => {
        void handler({}).then((r) => {
          capturedResult = r.structuredContent;
        });
      },
    };

    registerLeaderboardTool(mockServer as never);
    await new Promise((r) => setTimeout(r, 50));

    const result = capturedResult as { leaderboard: Array<{ standing: string }> };
    expect(result.leaderboard[0]?.standing).toBe('poor');
  });
});

// ─── Tool registration ────────────────────────────────────────────────────────

describe('registerLeaderboardTool', () => {
  it('registers the tool with the correct name', async () => {
    const { registerLeaderboardTool, LEADERBOARD_TOOL_NAME } =
      await import('@/packages/mcp/src/tools/leaderboard');
    const registeredNames: string[] = [];
    const mockServer = {
      registerTool: (name: string) => {
        registeredNames.push(name);
      },
    };
    registerLeaderboardTool(mockServer as never);
    expect(registeredNames).toContain(LEADERBOARD_TOOL_NAME);
    expect(LEADERBOARD_TOOL_NAME).toBe('intel.leaderboard');
  });

  it('returns structured content with leaderboard, corridor, and generatedAt', async () => {
    const { registerLeaderboardTool } = await import('@/packages/mcp/src/tools/leaderboard');

    const body = makeLeaderboardResponse({
      leaderboard: [
        makeEntry({ anchor_id: 'cowrie', composite: 0.9, n: 200 }),
        makeEntry({ anchor_id: 'moneygram', composite: 0.7, n: 50 }),
      ],
      corridor: null,
      generatedAt: '2026-08-26T12:00:00.000Z',
    });
    mockFetchOk(body);

    let capturedResult: unknown;
    const mockServer = {
      registerTool: (
        _name: string,
        _meta: unknown,
        handler: (args: Record<string, unknown>) => Promise<{
          structuredContent: unknown;
          content: Array<{ type: string; text: string }>;
        }>
      ) => {
        void handler({}).then((r) => {
          capturedResult = r.structuredContent;
        });
      },
    };

    registerLeaderboardTool(mockServer as never);
    await new Promise((r) => setTimeout(r, 50));

    const result = capturedResult as {
      corridor: string | null;
      generatedAt: string;
      leaderboard: Array<{ anchor_id: string }>;
    };
    expect(result.corridor).toBeNull();
    expect(result.generatedAt).toBe('2026-08-26T12:00:00.000Z');
    expect(result.leaderboard).toHaveLength(2);
    expect(result.leaderboard[0]?.anchor_id).toBe('cowrie');
    expect(result.leaderboard[1]?.anchor_id).toBe('moneygram');
  });

  it('passes the corridor arg to fetchLeaderboard', async () => {
    const { registerLeaderboardTool } = await import('@/packages/mcp/src/tools/leaderboard');

    const body = makeLeaderboardResponse({ corridor: 'usdc-ngn' });
    mockFetchOk(body);

    let capturedResult: unknown;
    const mockServer = {
      registerTool: (
        _name: string,
        _meta: unknown,
        handler: (args: Record<string, unknown>) => Promise<{ structuredContent: unknown }>
      ) => {
        void handler({ corridor: 'usdc-ngn' }).then((r) => {
          capturedResult = r.structuredContent;
        });
      },
    };

    registerLeaderboardTool(mockServer as never);
    await new Promise((r) => setTimeout(r, 50));

    // The URL called should include the corridor param
    const calledUrl = (fetchMock.mock.calls[0]?.[0] as string) ?? '';
    expect(calledUrl).toContain('corridor=usdc-ngn');

    const result = capturedResult as { corridor: string | null };
    expect(result.corridor).toBe('usdc-ngn');
  });

  it('returns isError: true and a text message when the API call fails', async () => {
    const { registerLeaderboardTool } = await import('@/packages/mcp/src/tools/leaderboard');

    mockFetchError(503, 'Service Unavailable');

    let capturedResponse: unknown;
    const mockServer = {
      registerTool: (
        _name: string,
        _meta: unknown,
        handler: (args: Record<string, unknown>) => Promise<{
          isError?: boolean;
          content: Array<{ type: string; text: string }>;
        }>
      ) => {
        void handler({}).then((r) => {
          capturedResponse = r;
        });
      },
    };

    registerLeaderboardTool(mockServer as never);
    await new Promise((r) => setTimeout(r, 50));

    const resp = capturedResponse as {
      isError: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(resp.isError).toBe(true);
    expect(resp.content[0]?.type).toBe('text');
    expect(resp.content[0]?.text).toMatch(/Leaderboard API error 503/);
  });

  it('content text is the JSON-stringified result', async () => {
    const { registerLeaderboardTool } = await import('@/packages/mcp/src/tools/leaderboard');

    const body = makeLeaderboardResponse();
    mockFetchOk(body);

    let capturedResponse: unknown;
    const mockServer = {
      registerTool: (
        _name: string,
        _meta: unknown,
        handler: (args: Record<string, unknown>) => Promise<{
          structuredContent: unknown;
          content: Array<{ type: string; text: string }>;
        }>
      ) => {
        void handler({}).then((r) => {
          capturedResponse = r;
        });
      },
    };

    registerLeaderboardTool(mockServer as never);
    await new Promise((r) => setTimeout(r, 50));

    const resp = capturedResponse as {
      structuredContent: unknown;
      content: Array<{ type: string; text: string }>;
    };
    expect(resp.content[0]?.type).toBe('text');
    // The text must be parseable JSON matching structuredContent
    const parsed: unknown = JSON.parse(resp.content[0]?.text ?? '');
    expect(parsed).toEqual(resp.structuredContent);
  });
});

// ─── Corridor filtering contract ──────────────────────────────────────────────

describe('corridor filtering via fetchLeaderboard', () => {
  it('does not append corridor param when argument is undefined', async () => {
    const { fetchLeaderboard } = await import('@/packages/mcp/src/tools/leaderboard');
    mockFetchOk(makeLeaderboardResponse());

    await fetchLeaderboard(undefined, 'http://localhost:3000');

    const calledUrl = (fetchMock.mock.calls[0]?.[0] as string) ?? '';
    expect(new URL(calledUrl).searchParams.has('corridor')).toBe(false);
  });

  it('appends corridor=usdc-kes when that corridor is requested', async () => {
    const { fetchLeaderboard } = await import('@/packages/mcp/src/tools/leaderboard');
    mockFetchOk(makeLeaderboardResponse({ corridor: 'usdc-kes' }));

    await fetchLeaderboard('usdc-kes', 'http://localhost:3000');

    const calledUrl = (fetchMock.mock.calls[0]?.[0] as string) ?? '';
    expect(new URL(calledUrl).searchParams.get('corridor')).toBe('usdc-kes');
  });

  it('echoes corridor from the API response', async () => {
    const { fetchLeaderboard } = await import('@/packages/mcp/src/tools/leaderboard');
    mockFetchOk(makeLeaderboardResponse({ corridor: 'usdc-ngn' }));

    const result = await fetchLeaderboard('usdc-ngn', 'http://localhost:3000');
    expect(result.corridor).toBe('usdc-ngn');
  });
});
