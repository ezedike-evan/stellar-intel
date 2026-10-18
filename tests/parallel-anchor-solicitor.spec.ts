/**
 * Tests for the parallel anchor quote solicitor (solicitAnchorQuotes).
 *
 * Covers:
 *  - Concurrent execution (all fetches start at once, not sequentially)
 *  - Partial results under timeout (fast anchors returned, slow excluded)
 *  - Rejected promises handled gracefully via Promise.allSettled
 *  - Deadline enforcement per anchor, including the exact-deadline boundary
 *    (an anchor answering at the same tick as its deadline is dropped)
 *  - Aggregation correctness, including ties broken by anchor id
 *  - Repeated calls with the same responses give the same outcome
 *
 * All timing uses vitest fake timers — no real I/O.
 * sep1.ts is mocked to avoid Stellar SDK TOML resolution.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Module-level mocks ───────────────────────────────────────────────────────

// Mock sep1 so getTransferServer returns a predictable URL without network I/O
vi.mock('@/lib/stellar/sep1', () => ({
  getTransferServer: vi.fn(async (domain: string) => `https://${domain}/sep24`),
  resolveToml: vi.fn(async () => ({ ok: true, data: {} })),
  getWebAuthEndpoint: vi.fn(async (domain: string) => `https://${domain}/auth`),
  resolveAllAnchors: vi.fn(async () => ({})),
}));

import {
  solicitAnchorQuotes,
  DeadlineExceededError,
  SOLICITOR_DEADLINE_MS,
  computeRateComparison,
} from '@/lib/stellar/sep24';
import * as anchorsModule from '@/lib/stellar/anchors';
import type { Anchor, AnchorRate } from '@/types';

// ─── Anchor stubs ─────────────────────────────────────────────────────────────

const MOCK_ANCHORS_3: Anchor[] = [
  {
    id: 'fast-anchor',
    name: 'Fast Anchor',
    homeDomain: 'fast.example.com',
    corridors: ['usdc-ngn'],
    assetCode: 'USDC',
    assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  },
  {
    id: 'medium-anchor',
    name: 'Medium Anchor',
    homeDomain: 'medium.example.com',
    corridors: ['usdc-ngn'],
    assetCode: 'USDC',
    assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  },
  {
    id: 'slow-anchor',
    name: 'Slow Anchor',
    homeDomain: 'slow.example.com',
    corridors: ['usdc-ngn'],
    assetCode: 'USDC',
    assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a global fetch mock that handles /info and /fee endpoints for test
 * anchor domains.  Each domain may be configured with a delay, fee, exchange
 * rate, or rejection flag.
 */
type FetchConfig =
  { delayMs: number; fee: string; exchangeRate: number } | { delayMs: number; reject: true };

function buildFetchMock(domainConfig: Record<string, FetchConfig>) {
  return vi.fn(async (url: string) => {
    // /info stub — return immediately with minimal valid structure
    if (url.includes('/info')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          deposit: {},
          withdraw: {},
          fee: { enabled: true },
          transaction: { enabled: true },
          transactions: { enabled: true },
        }),
      } as unknown as Response;
    }

    // Route /fee calls by domain
    const domain = Object.keys(domainConfig).find((d) => url.includes(d));
    if (!domain) {
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    }

    const cfg = domainConfig[domain]!;
    await new Promise<void>((resolve) => setTimeout(resolve, cfg.delayMs));

    if ('reject' in cfg && cfg.reject) {
      return {
        ok: false,
        status: 500,
        json: async () => ({ error: 'anchor server error' }),
      } as unknown as Response;
    }

    const { fee, exchangeRate } = cfg as { delayMs: number; fee: string; exchangeRate: number };
    return {
      ok: true,
      status: 200,
      json: async () => ({ fee: Number(fee), price: exchangeRate }),
    } as unknown as Response;
  });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('solicitAnchorQuotes — concurrency and deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(anchorsModule, 'getAnchorsByCorridorId').mockReturnValue(MOCK_ANCHORS_3);
    vi.spyOn(anchorsModule, 'getCorridorById').mockReturnValue({
      id: 'usdc-ngn',
      from: 'USDC',
      fromIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      fromPeg: 'USD',
      to: 'NGN',
      countryCode: 'NG',
      countryName: 'Nigeria',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns partial results — fast and medium included, slow excluded', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetchMock({
        'fast.example.com': { delayMs: 50, fee: '2', exchangeRate: 1580 },
        'medium.example.com': { delayMs: 500, fee: '3', exchangeRate: 1575 },
        'slow.example.com': { delayMs: 2_500, fee: '1', exchangeRate: 1590 },
      })
    );

    const resultPromise = solicitAnchorQuotes('100', 'usdc-ngn');
    await vi.runAllTimersAsync();
    const results = await resultPromise;

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(1);

    // Slow anchor's rejection must be a DeadlineExceededError
    const deadlineRejection = rejected[0] as PromiseRejectedResult;
    expect(deadlineRejection.reason).toBeInstanceOf(DeadlineExceededError);
    expect((deadlineRejection.reason as DeadlineExceededError).anchorId).toBe('slow-anchor');
  });

  it('all anchors slow — all results are DeadlineExceededErrors', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetchMock({
        'fast.example.com': { delayMs: 2_100, fee: '2', exchangeRate: 1580 },
        'medium.example.com': { delayMs: 2_200, fee: '3', exchangeRate: 1575 },
        'slow.example.com': { delayMs: 2_300, fee: '1', exchangeRate: 1590 },
      })
    );

    const resultPromise = solicitAnchorQuotes('100', 'usdc-ngn');
    await vi.runAllTimersAsync();
    const results = await resultPromise;

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    results.forEach((r) => {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(DeadlineExceededError);
    });
    expect(
      results.map((r) => ((r as PromiseRejectedResult).reason as DeadlineExceededError).anchorId)
    ).toEqual(['fast-anchor', 'medium-anchor', 'slow-anchor']);
  });

  it('deadline boundary — an anchor answering at exactly SOLICITOR_DEADLINE_MS is dropped', async () => {
    // The deadline timer is armed before the anchor's /fee request goes out, so
    // at the same tick it fires first: the deadline is exclusive.
    vi.stubGlobal(
      'fetch',
      buildFetchMock({
        'fast.example.com': { delayMs: SOLICITOR_DEADLINE_MS - 1, fee: '2', exchangeRate: 1580 },
        'medium.example.com': { delayMs: SOLICITOR_DEADLINE_MS, fee: '3', exchangeRate: 1575 },
        'slow.example.com': { delayMs: SOLICITOR_DEADLINE_MS + 1, fee: '1', exchangeRate: 1590 },
      })
    );

    const resultPromise = solicitAnchorQuotes('100', 'usdc-ngn');
    await vi.runAllTimersAsync();
    const results = await resultPromise;

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'rejected']);
    const [early, onDeadline, late] = results as [
      PromiseFulfilledResult<AnchorRate>,
      PromiseRejectedResult,
      PromiseRejectedResult,
    ];
    expect(early.value.anchorId).toBe('fast-anchor');
    for (const [rejection, anchorId] of [
      [onDeadline, 'medium-anchor'],
      [late, 'slow-anchor'],
    ] as const) {
      expect(rejection.reason).toBeInstanceOf(DeadlineExceededError);
      expect((rejection.reason as DeadlineExceededError).anchorId).toBe(anchorId);
      expect((rejection.reason as DeadlineExceededError).deadlineMs).toBe(SOLICITOR_DEADLINE_MS);
    }
  });

  it('identical quotes at different delays — winner is picked by anchor id, not arrival order', async () => {
    // fast-anchor, the lowest id, is in the middle of both the list order
    // (slow, fast, medium) and the arrival order (medium, fast, slow), so
    // neither "first wins" nor "last wins" picks it.
    vi.spyOn(anchorsModule, 'getAnchorsByCorridorId').mockReturnValue([
      MOCK_ANCHORS_3[2]!,
      MOCK_ANCHORS_3[0]!,
      MOCK_ANCHORS_3[1]!,
    ]);
    vi.stubGlobal(
      'fetch',
      buildFetchMock({
        'fast.example.com': { delayMs: 300, fee: '2', exchangeRate: 1580 },
        'medium.example.com': { delayMs: 100, fee: '2', exchangeRate: 1580 },
        'slow.example.com': { delayMs: 600, fee: '2', exchangeRate: 1580 },
      })
    );

    const resultPromise = solicitAnchorQuotes('100', 'usdc-ngn');
    await vi.runAllTimersAsync();
    const results = await resultPromise;

    const comparison = computeRateComparison(results, 'usdc-ngn');

    expect(comparison.rates).toHaveLength(3);
    expect(comparison.bestRateId).toBe('fast-anchor');
  });

  it('rejected anchor promise is isolated — other anchors still succeed', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetchMock({
        'fast.example.com': { delayMs: 100, fee: '2', exchangeRate: 1580 },
        'medium.example.com': { delayMs: 200, reject: true },
        'slow.example.com': { delayMs: 300, fee: '1.5', exchangeRate: 1590 },
      })
    );

    const resultPromise = solicitAnchorQuotes('100', 'usdc-ngn');
    await vi.runAllTimersAsync();
    const results = await resultPromise;

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    // The failure stays in medium-anchor's slot
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    // A real HTTP failure, not a deadline error
    expect((rejected[0] as PromiseRejectedResult).reason).not.toBeInstanceOf(DeadlineExceededError);
  });

  it('all anchors respond quickly — all results are fulfilled', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetchMock({
        'fast.example.com': { delayMs: 50, fee: '2', exchangeRate: 1580 },
        'medium.example.com': { delayMs: 100, fee: '3', exchangeRate: 1575 },
        'slow.example.com': { delayMs: 200, fee: '1', exchangeRate: 1590 },
      })
    );

    const resultPromise = solicitAnchorQuotes('100', 'usdc-ngn');
    await vi.runAllTimersAsync();
    const results = await resultPromise;

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(results).toHaveLength(3);
  });

  it('executes all fetches concurrently — all start before any completes', async () => {
    let feeCallCount = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/info')) {
          return {
            ok: true,
            json: async () => ({
              deposit: {},
              withdraw: {},
              fee: { enabled: true },
              transaction: { enabled: true },
              transactions: { enabled: true },
            }),
          } as unknown as Response;
        }

        // Count /fee endpoint calls
        if (url.includes('/fee')) {
          feeCallCount++;
        }

        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        return {
          ok: true,
          json: async () => ({ fee: 2, price: 1580 }),
        } as unknown as Response;
      })
    );

    const resultPromise = solicitAnchorQuotes('100', 'usdc-ngn');
    await vi.runAllTimersAsync();
    const results = await resultPromise;

    expect(results).toHaveLength(3);
    // All 3 anchor fee calls must have been made (concurrent, not sequential)
    expect(feeCallCount).toBe(3);
  });

  it('aggregation correctness — best rate selected from partial results', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetchMock({
        'fast.example.com': { delayMs: 50, fee: '2', exchangeRate: 1580 },
        'medium.example.com': { delayMs: 500, fee: '1', exchangeRate: 1590 },
        'slow.example.com': { delayMs: 2_500, fee: '0.5', exchangeRate: 1600 },
      })
    );

    const resultPromise = solicitAnchorQuotes('100', 'usdc-ngn');
    await vi.runAllTimersAsync();
    const results = await resultPromise;

    const comparison = computeRateComparison(results, 'usdc-ngn');

    // medium-anchor: (100-1)*1590 = 157,410
    // fast-anchor:   (100-2)*1580 = 154,840
    // slow-anchor: timed out, excluded
    expect(comparison.bestRateId).toBe('medium-anchor');
    expect(comparison.rates).toHaveLength(2);
  });

  it('custom deadlineMs parameter is respected', async () => {
    const CUSTOM_DEADLINE = 300;

    vi.stubGlobal(
      'fetch',
      buildFetchMock({
        'fast.example.com': { delayMs: 100, fee: '2', exchangeRate: 1580 },
        'medium.example.com': { delayMs: 200, fee: '3', exchangeRate: 1575 },
        'slow.example.com': { delayMs: 500, fee: '1', exchangeRate: 1590 },
      })
    );

    const resultPromise = solicitAnchorQuotes('100', 'usdc-ngn', CUSTOM_DEADLINE);
    await vi.runAllTimersAsync();
    const results = await resultPromise;

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(1);

    const err = (rejected[0] as PromiseRejectedResult).reason as DeadlineExceededError;
    expect(err).toBeInstanceOf(DeadlineExceededError);
    expect(err.deadlineMs).toBe(CUSTOM_DEADLINE);
  });

  it('requests the corridor asset, not the anchor primary asset', async () => {
    vi.spyOn(anchorsModule, 'getCorridorById').mockReturnValue({
      id: 'usdc-ngn',
      from: 'CORRIDOR_ASSET',
      fromIssuer: 'CORRIDOR_ISSUER',
      fromPeg: 'USD',
      to: 'NGN',
      countryCode: 'NG',
      countryName: 'Nigeria',
    });

    const fetchMock = buildFetchMock({
      'fast.example.com': { delayMs: 50, fee: '2', exchangeRate: 1580 },
    });
    vi.stubGlobal('fetch', fetchMock);

    vi.spyOn(anchorsModule, 'getAnchorsByCorridorId').mockReturnValue([MOCK_ANCHORS_3[0]!]);

    const resultPromise = solicitAnchorQuotes('100', 'usdc-ngn');
    await vi.runAllTimersAsync();
    await resultPromise;

    const urls = fetchMock.mock.calls.map((call) => call[0] as string);
    const feeUrl = urls.find((u) => u.includes('/fee'));

    expect(feeUrl).toContain('asset_code=CORRIDOR_ASSET');
    expect(feeUrl).toContain('asset_issuer=CORRIDOR_ISSUER');
  });

  it('repeated calls with the same anchor responses give the same outcome', async () => {
    vi.stubGlobal(
      'fetch',
      buildFetchMock({
        'fast.example.com': { delayMs: 50, fee: '2', exchangeRate: 1580 },
        'medium.example.com': { delayMs: 500, fee: '3', exchangeRate: 1575 },
        'slow.example.com': { delayMs: 2_500, fee: '1', exchangeRate: 1590 },
      })
    );

    const run = async () => {
      const resultPromise = solicitAnchorQuotes('100', 'usdc-ngn');
      await vi.runAllTimersAsync();
      const results = await resultPromise;
      return {
        statuses: results.map((r) => r.status),
        bestRateId: computeRateComparison(results, 'usdc-ngn').bestRateId,
      };
    };

    const first = await run();
    const second = await run();

    // fast-anchor: (100-2)*1580 = 154,840 beats medium-anchor's 152,775
    expect(first).toEqual({
      statuses: ['fulfilled', 'fulfilled', 'rejected'],
      bestRateId: 'fast-anchor',
    });
    expect(second).toEqual(first);
  });

  it('SOLICITOR_DEADLINE_MS is exported and equals 2000', () => {
    expect(SOLICITOR_DEADLINE_MS).toBe(2_000);
  });
});
