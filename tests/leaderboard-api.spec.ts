/**
 * `/api/reputation/leaderboard` route tests (#1032).
 *
 * The handler reads each anchor's on-chain scorecard through
 * `lib/oracle/read.ts`, which issues one Soroban RPC `simulateTransaction`
 * round-trip per anchor. Left unstubbed, those calls made the corridor-filter
 * block time out whenever a testnet RPC or an anchor was slow, turning a
 * degraded upstream into a red build.
 *
 * Both sides of the handler's I/O are pinned here:
 *   - outbound RPC → MSW, backed by responses recorded off testnet (see
 *     `tests/msw/oracle.ts` for fixture provenance). `onUnhandledRequest:
 *     'error'` fails the test on any request that is not stubbed, so a new
 *     network dependency cannot slip back in unnoticed.
 *   - the reputation store → an in-memory store seeded with a fixed outcome
 *     log, so composites, ranking and sample counts are exact rather than the
 *     all-zero scorecards an empty store yields.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/reputation/leaderboard/route';
import type { LeaderboardResponse, LeaderboardEntry } from '@/app/api/reputation/leaderboard/route';
import { InMemoryReputationStore, _setReputationStore } from '@/lib/reputation/store';
import type { OutcomeLogRow } from '@/types/reputation';
import type { ApiError } from '@/types';
import {
  oracleHandlers,
  scoredOracleHandler,
  failingOracleHandler,
  oracleRequests,
  resetOracleRequests,
} from './msw/oracle';

// ─── Network stub ─────────────────────────────────────────────────────────────

const server = setupServer(...oracleHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetOracleRequests();
  vi.clearAllMocks();
});
afterAll(() => {
  server.close();
  _setReputationStore(null);
});

// ─── Seeded outcome log ───────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** One day old — inside every rolling window, so the fixture never ages out. */
function recordedAt(): string {
  return new Date(Date.now() - DAY_MS).toISOString();
}

function outcomeRow(
  overrides: Partial<OutcomeLogRow> & Pick<OutcomeLogRow, 'intentHash'>
): OutcomeLogRow {
  return {
    anchorId: 'moneygram',
    corridor: 'usdc-ngn',
    quotedRate: '1500',
    deliveredRate: '1500',
    quotedAmount: '100',
    deliveredAmount: '100',
    settleSeconds: 60,
    outcome: 'completed',
    createdAt: recordedAt(),
    stellarTransactionId: null,
    reconciledAt: null,
    disputed: false,
    disputedReason: null,
    publishedAt: null,
    oracleTxHash: null,
    ...overrides,
  };
}

/**
 * moneygram: 2/2 filled, 60 s, no slippage   → composite 0.94
 * anclap:    1/1 filled, 120 s, 1 % slippage → composite 0.82
 * cowrie:    1/2 filled, 240 s, 2 % slippage → composite 0.44
 * Every other registered anchor has no outcomes and scores 0 with n = 0.
 */
const SEED_ROWS: OutcomeLogRow[] = [
  outcomeRow({ intentHash: 'mg-1' }),
  outcomeRow({ intentHash: 'mg-2' }),
  outcomeRow({
    intentHash: 'cw-1',
    anchorId: 'cowrie',
    settleSeconds: 240,
    deliveredRate: '1470', // 2 % below the quoted 1500
  }),
  outcomeRow({
    intentHash: 'cw-2',
    anchorId: 'cowrie',
    settleSeconds: 240,
    outcome: 'error',
    deliveredRate: null,
    deliveredAmount: null,
  }),
  outcomeRow({
    intentHash: 'ac-1',
    anchorId: 'anclap',
    corridor: 'usdc-ars',
    settleSeconds: 120,
    deliveredRate: '1485', // 1 % below the quoted 1500
  }),
];

const MONEYGRAM_COMPOSITE = 0.94;
const ANCLAP_COMPOSITE = 0.82;
const COWRIE_COMPOSITE = 0.44;

beforeEach(async () => {
  const store = new InMemoryReputationStore();
  for (const row of SEED_ROWS) await store.append(row);
  _setReputationStore(store);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost/api/reputation/leaderboard');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url.toString(), { method: 'GET' });
}

function makeConditionalRequest(etag: string): NextRequest {
  const url = new URL('http://localhost/api/reputation/leaderboard');
  return new NextRequest(url.toString(), {
    method: 'GET',
    headers: { 'if-none-match': etag },
  });
}

async function leaderboardFor(params: Record<string, string> = {}): Promise<LeaderboardResponse> {
  const res = await GET(makeRequest(params));
  expect(res.status).toBe(200);
  return (await res.json()) as LeaderboardResponse;
}

function idsOf(data: LeaderboardResponse): string[] {
  return data.leaderboard.map((e: LeaderboardEntry) => e.anchor_id);
}

function entryFor(data: LeaderboardResponse, anchorId: string): LeaderboardEntry {
  const entry = data.leaderboard.find((e: LeaderboardEntry) => e.anchor_id === anchorId);
  expect(entry, `expected ${anchorId} in the leaderboard`).toBeDefined();
  return entry as LeaderboardEntry;
}

// ─── Happy path — no corridor filter ─────────────────────────────────────────

describe('GET /api/reputation/leaderboard — no corridor filter', () => {
  it('returns 200', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
  });

  it('response body has leaderboard array, corridor null, and generatedAt', async () => {
    const data = await leaderboardFor();

    expect(Array.isArray(data.leaderboard)).toBe(true);
    expect(data.corridor).toBeNull();
    expect(typeof data.generatedAt).toBe('string');
    expect(new Date(data.generatedAt).getTime()).not.toBeNaN();
  });

  it('each entry has the required fields with correct types', async () => {
    const data = await leaderboardFor();

    for (const entry of data.leaderboard) {
      expect(typeof entry.anchor_id).toBe('string');
      expect(entry.anchor_id.length).toBeGreaterThan(0);
      expect(typeof entry.composite).toBe('number');
      expect(typeof entry.fill_rate).toBe('number');
      expect(typeof entry.settle_p50).toBe('number');
      expect(typeof entry.slippage_p50).toBe('number');
      expect(typeof entry.n).toBe('number');
    }
  });

  it('composite score is between 0 and 1 for every entry', async () => {
    const data = await leaderboardFor();

    for (const entry of data.leaderboard) {
      expect(entry.composite).toBeGreaterThanOrEqual(0);
      expect(entry.composite).toBeLessThanOrEqual(1);
    }
  });

  it('leaderboard is sorted descending by composite score', async () => {
    const data = await leaderboardFor();
    const scores = data.leaderboard.map((e: LeaderboardEntry) => e.composite);

    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]!);
    }
  });

  it('ranks the seeded anchors by their outcome record', async () => {
    const data = await leaderboardFor();
    const ranked = idsOf(data);

    expect(entryFor(data, 'moneygram').composite).toBeCloseTo(MONEYGRAM_COMPOSITE, 4);
    expect(entryFor(data, 'anclap').composite).toBeCloseTo(ANCLAP_COMPOSITE, 4);
    expect(entryFor(data, 'cowrie').composite).toBeCloseTo(COWRIE_COMPOSITE, 4);
    expect(ranked.indexOf('moneygram')).toBeLessThan(ranked.indexOf('anclap'));
    expect(ranked.indexOf('anclap')).toBeLessThan(ranked.indexOf('cowrie'));
  });

  it('reports scorecard inputs from the seeded outcome log', async () => {
    const cowrie = entryFor(await leaderboardFor(), 'cowrie');

    expect(cowrie.n).toBe(2);
    expect(cowrie.fill_rate).toBeCloseTo(0.5, 4);
    expect(cowrie.settle_p50).toBeCloseTo(240, 4);
    expect(cowrie.slippage_p50).toBeCloseTo(0.02, 4);
  });

  it('scores an anchor with no outcomes at zero rather than as perfect', async () => {
    const unscored = entryFor(await leaderboardFor(), 'ngnc');

    expect(unscored.n).toBe(0);
    expect(unscored.composite).toBe(0);
  });

  it('returns every registered anchor', async () => {
    const data = await leaderboardFor();

    expect(data.leaderboard.length).toBeGreaterThan(0);
    expect(idsOf(data)).toEqual(expect.arrayContaining(['moneygram', 'cowrie', 'anclap']));
  });

  it('does not read the oracle when no corridor is given', async () => {
    const data = await leaderboardFor();

    expect(oracleRequests()).toHaveLength(0);
    for (const entry of data.leaderboard) {
      expect(entry.onChain).toBeNull();
    }
  });
});

// ─── Happy path — corridor filter ────────────────────────────────────────────

describe('GET /api/reputation/leaderboard — with corridor filter', () => {
  it('returns 200 for a valid corridor', async () => {
    const res = await GET(makeRequest({ corridor: 'usdc-ngn' }));
    expect(res.status).toBe(200);
  });

  it('echoes the corridor in the response body', async () => {
    const data = await leaderboardFor({ corridor: 'usdc-ngn' });
    expect(data.corridor).toBe('usdc-ngn');
  });

  it('only returns anchors that serve the requested corridor', async () => {
    const ids = idsOf(await leaderboardFor({ corridor: 'usdc-ngn' }));

    // moneygram, cowrie and ngnc all serve usdc-ngn; anclap does not.
    expect(ids).toContain('moneygram');
    expect(ids).toContain('cowrie');
    expect(ids).toContain('ngnc');
    expect(ids).not.toContain('anclap');
  });

  it('returns only anclap for the usdc-ars corridor', async () => {
    const ids = idsOf(await leaderboardFor({ corridor: 'usdc-ars' }));
    expect(ids).toEqual(['anclap']);
  });

  it('returns an empty leaderboard for a valid corridor no anchor serves', async () => {
    // usdc-xof is registered in CORRIDORS but scaffolded ahead of anchor
    // onboarding — an unserved corridor is an empty list, not an error.
    const data = await leaderboardFor({ corridor: 'usdc-xof' });
    expect(data.leaderboard).toEqual([]);
  });

  it('queries the oracle once per anchor that serves the corridor', async () => {
    await leaderboardFor({ corridor: 'usdc-ars' });

    expect(oracleRequests()).toHaveLength(1);
    expect(oracleRequests()[0]?.method).toBe('simulateTransaction');
  });

  it('reports an anchor the oracle has no outcomes for as absent, not as zero', async () => {
    // The contract returns a zeroed tuple for a pair it has never seen;
    // `getScoreForCorridor` reports that as null rather than a real 0 score.
    const data = await leaderboardFor({ corridor: 'usdc-ars' });

    expect(oracleRequests()).toHaveLength(1);
    expect(entryFor(data, 'anclap').onChain).toBeNull();
  });

  it('surfaces the on-chain score returned by the oracle', async () => {
    server.use(scoredOracleHandler);

    const data = await leaderboardFor({ corridor: 'usdc-ars' });

    expect(entryFor(data, 'anclap').onChain).toEqual({
      compositeBps: 8123,
      fillRateBps: 9600,
      settleSecondsP50: 142,
      n: 37,
    });
  });

  it('degrades onChain to null when the oracle read fails', async () => {
    server.use(failingOracleHandler);

    const anclap = entryFor(await leaderboardFor({ corridor: 'usdc-ars' }), 'anclap');

    expect(anclap.onChain).toBeNull();
    // The off-chain scorecard is unaffected by an oracle outage.
    expect(anclap.composite).toBeCloseTo(ANCLAP_COMPOSITE, 4);
  });
});

// ─── Caching headers ──────────────────────────────────────────────────────────

describe('GET /api/reputation/leaderboard — caching', () => {
  it('response includes a Cache-Control header with max-age=60', async () => {
    const res = await GET(makeRequest());
    const cc = res.headers.get('cache-control') ?? '';
    expect(cc).toMatch(/max-age=60/);
  });

  it('response includes an ETag header', async () => {
    const res = await GET(makeRequest());
    const etag = res.headers.get('etag');
    expect(etag).not.toBeNull();
    expect(typeof etag).toBe('string');
    expect((etag as string).length).toBeGreaterThan(0);
  });

  it('ETag is a quoted string', async () => {
    const res = await GET(makeRequest());
    const etag = res.headers.get('etag') as string;
    expect(etag).toMatch(/^".*"$/);
  });

  it('returns 304 when If-None-Match matches the current ETag', async () => {
    const first = await GET(makeRequest());
    const etag = first.headers.get('etag') as string;

    const second = await GET(makeConditionalRequest(etag));
    expect(second.status).toBe(304);
  });

  it('returns 200 when If-None-Match does not match', async () => {
    const res = await GET(makeConditionalRequest('"stale-etag-value"'));
    expect(res.status).toBe(200);
  });
});

// ─── Validation errors ────────────────────────────────────────────────────────

describe('GET /api/reputation/leaderboard — validation errors', () => {
  it('returns 400 with VALIDATION_ERROR for an unknown corridor', async () => {
    const res = await GET(makeRequest({ corridor: 'usdc-xyz' }));
    expect(res.status).toBe(400);

    const err = (await res.json()) as ApiError;
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(typeof err.message).toBe('string');
    expect(err.message.length).toBeGreaterThan(0);
  });

  it('error body always has a string message field', async () => {
    const res = await GET(makeRequest({ corridor: 'not-a-real-corridor' }));
    expect(res.status).toBe(400);
    const err = (await res.json()) as ApiError;
    expect(typeof err.message).toBe('string');
  });

  it('rejects an unknown corridor without touching the network', async () => {
    await GET(makeRequest({ corridor: 'usdc-xyz' }));
    expect(oracleRequests()).toHaveLength(0);
  });
});
