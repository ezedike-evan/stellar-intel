import { describe, expect, test } from 'vitest';
import { GET } from '@/app/api/reputation/leaderboard/route';

interface LeaderboardEntry {
  anchorId: string;
  composite: number;
  fillRate: number;
}

describe('GET /api/reputation/leaderboard', () => {
  test('returns all anchors ordered by composite descending by default', async () => {
    const response = await GET(new Request('http://localhost/api/reputation/leaderboard'));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.sortKey).toBe('composite');
    expect(body.direction).toBe('desc');
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries).toHaveLength(3);
    expect(body.entries[0].composite).toBeGreaterThanOrEqual(body.entries[1].composite);
  });

  test('filters anchors by corridor and sorts by fill rate ascending', async () => {
    const response = await GET(
      new Request(
        'http://localhost/api/reputation/leaderboard?corridor=usdc-ngn&sort=fillRate&direction=asc'
      )
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.corridorId).toBe('usdc-ngn');
    expect(body.sortKey).toBe('fillRate');
    expect(body.direction).toBe('asc');
    expect(body.entries.length).toBeGreaterThanOrEqual(1);
    expect(body.entries[0].fillRate).toBeLessThanOrEqual(body.entries[1]?.fillRate ?? Infinity);
    expect(
      body.entries.every(
        (entry: LeaderboardEntry) => entry.anchorId === 'moneygram' || entry.anchorId === 'cowrie'
      )
    ).toBe(true);
  });
});
