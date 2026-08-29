import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchAnchorReputation, ANCHOR_REPUTATION_TOOL_NAME } from './anchor-reputation.js';
import type { AnchorReputationOutput } from './anchor-reputation.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('anchor-reputation tool', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  });

  const baseOkResponse: AnchorReputationOutput = {
    anchorId: 'cowrie',
    scorecards: {
      7: {
        state: 'ok',
        window: 7,
        sampleSize: 42,
        fillRate: 0.95,
        settleMs: { p50: 120000, p95: 300000 },
        slippage: { p50: 0.005, p95: 0.02 },
        computedAt: '2024-01-15T12:00:00.000Z',
        lastPublisherTxTimestamp: '2024-01-15T10:00:00.000Z',
      },
      30: {
        state: 'ok',
        window: 30,
        sampleSize: 180,
        fillRate: 0.93,
        settleMs: { p50: 150000, p95: 350000 },
        slippage: { p50: 0.008, p95: 0.025 },
        computedAt: '2024-01-15T12:00:00.000Z',
        lastPublisherTxTimestamp: '2024-01-15T10:00:00.000Z',
      },
      90: {
        state: 'ok',
        window: 90,
        sampleSize: 500,
        fillRate: 0.91,
        settleMs: { p50: 180000, p95: 400000 },
        slippage: { p50: 0.01, p95: 0.03 },
        computedAt: '2024-01-15T12:00:00.000Z',
        lastPublisherTxTimestamp: '2024-01-15T10:00:00.000Z',
      },
    },
  };

  const baseInsufficientResponse: AnchorReputationOutput = {
    anchorId: 'newanchor',
    scorecards: {
      7: {
        state: 'insufficient_data',
        window: 7,
        sampleSize: 0,
        computedAt: '2024-01-15T12:00:00.000Z',
        lastPublisherTxTimestamp: null,
      },
      30: {
        state: 'insufficient_data',
        window: 30,
        sampleSize: 0,
        computedAt: '2024-01-15T12:00:00.000Z',
        lastPublisherTxTimestamp: null,
      },
      90: {
        state: 'insufficient_data',
        window: 90,
        sampleSize: 0,
        computedAt: '2024-01-15T12:00:00.000Z',
        lastPublisherTxTimestamp: null,
      },
    },
  };

  it('fetches and returns ok scorecards for anchor with data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(baseOkResponse),
    });

    const result = await fetchAnchorReputation('cowrie');

    expect(result).toEqual(baseOkResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/reputation/cowrie',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
  });

  it('returns insufficient_data scorecards for anchor with no outcomes', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(baseInsufficientResponse),
    });

    const result = await fetchAnchorReputation('newanchor');

    expect(result.anchorId).toBe('newanchor');
    expect(result.scorecards[7].state).toBe('insufficient_data');
    expect(result.scorecards[7].sampleSize).toBe(0);
    expect(result.scorecards[30].state).toBe('insufficient_data');
    expect(result.scorecards[90].state).toBe('insufficient_data');
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not Found'),
    });

    await expect(fetchAnchorReputation('unknown')).rejects.toThrow(
      'Failed to fetch reputation for unknown: 404 Not Found'
    );
  });

  it('throws on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(fetchAnchorReputation('cowrie')).rejects.toThrow('Network error');
  });

  it('uses NEXT_PUBLIC_APP_URL from env', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://prod.example.com';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(baseOkResponse),
    });

    await fetchAnchorReputation('cowrie');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://prod.example.com/api/reputation/cowrie',
      expect.any(Object)
    );
  });

  it('tool name is correct', () => {
    expect(ANCHOR_REPUTATION_TOOL_NAME).toBe('intel.anchor.reputation');
  });
});
