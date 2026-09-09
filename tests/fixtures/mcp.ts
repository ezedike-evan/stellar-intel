/**
 * tests/fixtures/mcp.ts
 *
 * Stubbed responses for the MCP tool contract tests (#1052).
 *
 * The live e2e (tests/mcp-e2e.spec.ts) spawns a subprocess and calls real
 * anchors, so it can only ever tell us the wiring works *today, from this
 * network*. These fixtures are the other half: fixed payloads that let every
 * tool handler be exercised with the network unplugged, so the tool contracts
 * are covered deterministically and in milliseconds.
 *
 * Nothing here imports the MCP SDK — the fixtures are plain data plus a fetch
 * stub, so they are equally usable from a handler test or a direct unit test.
 */
import type { ServerRatesResult } from '@/lib/stellar/server-rates';

// ─── Corridor rates (intel.offramp.quote) ────────────────────────────────────

/** Corridors the stubbed rate source can quote, and what it quotes them at. */
const STUBBED_CORRIDORS: Record<string, { anchorId: string; anchorName: string; rate: number }> = {
  'usdc-ngn': { anchorId: 'cowrie', anchorName: 'Cowrie', rate: 1600 },
  'usdc-kes': { anchorId: 'flutterwave', anchorName: 'Flutterwave', rate: 129 },
};

/**
 * Amount that makes {@link stubbedCorridorRates} answer as though the routed
 * anchor cannot currently be quoted — the RATE_UNAVAILABLE path, which is a
 * real and frequent outcome against live anchors and therefore part of the
 * contract rather than an edge case.
 */
export const UNQUOTABLE_AMOUNT = '999999';

/** Flat fee the stub deducts before applying the rate, in the sold asset. */
const STUB_FEE = 2;

/** What the stub says `intel.offramp.quote` should net for a given amount. */
export function expectedNetReceived(corridorId: string, amount: string): number {
  const corridor = STUBBED_CORRIDORS[corridorId];
  if (!corridor) throw new Error(`No stubbed corridor "${corridorId}"`);
  return (Number(amount) - STUB_FEE) * corridor.rate;
}

/**
 * A deterministic stand-in for `fetchCorridorRates`, which otherwise fans out
 * to SEP-38/24/6 endpoints across the open internet.
 */
export function stubbedCorridorRates(corridorId: string, amount: string): ServerRatesResult {
  const corridor = STUBBED_CORRIDORS[corridorId];

  if (!corridor) {
    return { corridorId, rates: [], pending: [], bestRateId: '', errors: [] };
  }

  if (amount === UNQUOTABLE_AMOUNT) {
    return {
      corridorId,
      rates: [],
      pending: [],
      bestRateId: '',
      errors: [
        {
          anchorId: corridor.anchorId,
          anchorName: corridor.anchorName,
          reason: 'anchor unreachable',
        },
      ],
    };
  }

  return {
    corridorId,
    rates: [
      {
        anchorId: corridor.anchorId,
        anchorName: corridor.anchorName,
        corridorId,
        fee: STUB_FEE,
        feeType: 'flat',
        exchangeRate: corridor.rate,
        totalReceived: expectedNetReceived(corridorId, amount),
        source: 'sep38',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
    pending: [],
    bestRateId: corridor.anchorId,
    errors: [],
  };
}

// ─── Anchor health (intel.anchor.health) ─────────────────────────────────────

/** The shape `/api/v1/anchors/{id}/health` answers with. */
export const HEALTHY_ANCHOR = {
  anchorId: 'cowrie',
  status: 'ok',
  consecutiveFailures: 0,
  degraded: false,
  lastCheckedAt: '2026-01-01T00:00:00.000Z',
  lastError: null,
  stale: false,
} as const;

export const DEGRADED_ANCHOR = {
  anchorId: 'anclap',
  status: 'fail',
  consecutiveFailures: 4,
  degraded: true,
  lastCheckedAt: '2026-01-01T00:00:00.000Z',
  lastError: 'missing TRANSFER_SERVER_SEP0024 (SEP-24)',
  stale: false,
} as const;

// ─── Anchor reputation (intel.anchor.reputation) ─────────────────────────────

/** The shape `/api/reputation/{anchor}` answers with. */
export const ANCHOR_REPUTATION = {
  anchorId: 'cowrie',
  scorecards: {
    7: {
      state: 'ok',
      window: 7,
      sampleSize: 42,
      fillRate: 0.98,
      settleMs: { p50: 4200, p95: 9100 },
      slippage: { p50: 0.001, p95: 0.004 },
      computedAt: '2026-01-01T00:00:00.000Z',
      lastPublisherTxTimestamp: '2026-01-01T00:00:00.000Z',
    },
    30: {
      state: 'ok',
      window: 30,
      sampleSize: 180,
      fillRate: 0.97,
      settleMs: { p50: 4400, p95: 9600 },
      slippage: { p50: 0.0012, p95: 0.0045 },
      computedAt: '2026-01-01T00:00:00.000Z',
      lastPublisherTxTimestamp: '2026-01-01T00:00:00.000Z',
    },
    // A window with too few outcomes is labelled, not smoothed into a number —
    // the tools must carry that distinction through rather than flatten it.
    90: {
      state: 'insufficient_data',
      window: 90,
      sampleSize: 3,
      computedAt: '2026-01-01T00:00:00.000Z',
      lastPublisherTxTimestamp: null,
    },
  },
} as const;

// ─── Fetch stub ──────────────────────────────────────────────────────────────

export interface StubbedRoute {
  /** Matched against the request URL with `String.includes`. */
  urlContains: string;
  status?: number;
  body: unknown;
}

/**
 * Builds a `fetch` replacement that answers the given routes and *throws* on
 * anything else.
 *
 * Throwing rather than returning a 404 is the point: a handler that grows a
 * second network call fails loudly here instead of quietly reaching the real
 * internet and making this suite as slow and load-sensitive as the e2e it is
 * meant to relieve.
 */
export function stubFetch(routes: StubbedRoute[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const route = routes.find((r) => url.includes(r.urlContains));

    if (!route) {
      throw new Error(`Unstubbed network call in an offline test: ${url}`);
    }

    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route.body,
      text: async () => (typeof route.body === 'string' ? route.body : JSON.stringify(route.body)),
    } as Response;
  }) as typeof fetch;
}
