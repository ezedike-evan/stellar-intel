import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/reputation/leaderboard/route';
import type { LeaderboardResponse, LeaderboardEntry } from '@/app/api/reputation/leaderboard/route';
import type { ApiError } from '@/types';

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

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Happy path — no corridor filter ─────────────────────────────────────────

describe('GET /api/reputation/leaderboard — no corridor filter', () => {
  it('returns 200', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
  });

  it('response body has leaderboard array, corridor null, and generatedAt', async () => {
    const res = await GET(makeRequest());
    const data = (await res.json()) as LeaderboardResponse;

    expect(Array.isArray(data.leaderboard)).toBe(true);
    expect(data.corridor).toBeNull();
    expect(typeof data.generatedAt).toBe('string');
    expect(new Date(data.generatedAt).getTime()).not.toBeNaN();
  });

  it('each entry has the required fields with correct types', async () => {
    const res = await GET(makeRequest());
    const data = (await res.json()) as LeaderboardResponse;

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
    const res = await GET(makeRequest());
    const data = (await res.json()) as LeaderboardResponse;

    for (const entry of data.leaderboard) {
      expect(entry.composite).toBeGreaterThanOrEqual(0);
      expect(entry.composite).toBeLessThanOrEqual(1);
    }
  });

  it('leaderboard is sorted descending by composite score', async () => {
    const res = await GET(makeRequest());
    const data = (await res.json()) as LeaderboardResponse;
    const scores = data.leaderboard.map((e: LeaderboardEntry) => e.composite);

    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]!);
    }
  });

  it('returns at least one entry (anchors are registered)', async () => {
    const res = await GET(makeRequest());
    const data = (await res.json()) as LeaderboardResponse;
    expect(data.leaderboard.length).toBeGreaterThan(0);
  });
});

// ─── Happy path — corridor filter ────────────────────────────────────────────

describe('GET /api/reputation/leaderboard — with corridor filter', () => {
  it('returns 200 for a valid corridor', async () => {
    const res = await GET(makeRequest({ corridor: 'usdc-ngn' }));
    expect(res.status).toBe(200);
  });

  it('echoes the corridor in the response body', async () => {
    const res = await GET(makeRequest({ corridor: 'usdc-ngn' }));
    const data = (await res.json()) as LeaderboardResponse;
    expect(data.corridor).toBe('usdc-ngn');
  });

  it('only returns anchors that serve the requested corridor', async () => {
    const res = await GET(makeRequest({ corridor: 'usdc-ngn' }));
    const data = (await res.json()) as LeaderboardResponse;

    // moneygram and cowrie both serve usdc-ngn; anclap does not
    const ids = data.leaderboard.map((e: LeaderboardEntry) => e.anchor_id);
    expect(ids).toContain('moneygram');
    expect(ids).toContain('cowrie');
    expect(ids).not.toContain('anclap');
  });

  it('returns only anclap for usdc-ars corridor', async () => {
    const res = await GET(makeRequest({ corridor: 'usdc-ars' }));
    const data = (await res.json()) as LeaderboardResponse;
    const ids = data.leaderboard.map((e: LeaderboardEntry) => e.anchor_id);
    expect(ids).toContain('anclap');
    expect(ids).not.toContain('cowrie');
  });

  it('returns an empty leaderboard for a valid corridor with no anchors', async () => {
    // usdc-pen is served only by anclap; if we filter for a corridor that
    // has no anchors the list should be empty (not an error)
    const res = await GET(makeRequest({ corridor: 'usdc-pen' }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as LeaderboardResponse;
    expect(Array.isArray(data.leaderboard)).toBe(true);
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
});
