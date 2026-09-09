import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchAnchorHealth, ANCHOR_HEALTH_TOOL_NAME } from './anchor-health.js';
import type { AnchorHealthOutput } from './anchor-health.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('anchor-health tool', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  });

  const baseOkResponse: AnchorHealthOutput = {
    anchorId: 'cowrie',
    status: 'ok',
    consecutiveFailures: 0,
    degraded: false,
    lastCheckedAt: '2024-01-15T12:00:00.000Z',
    lastError: null,
    stale: false,
  };

  const baseDegradedResponse: AnchorHealthOutput = {
    anchorId: 'anclap',
    status: 'fail',
    consecutiveFailures: 4,
    degraded: true,
    lastCheckedAt: '2024-01-15T12:00:00.000Z',
    lastError: 'connection timeout',
    stale: false,
  };

  it('fetches and returns ok health for anchor domain', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(baseOkResponse),
    });

    const result = await fetchAnchorHealth('cowrie.exchange');

    expect(result).toEqual(baseOkResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/anchors/cowrie/health',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
  });

  it('resolves using serviceDomain when appropriate', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(baseOkResponse), // moneygram
    });

    // moneygram homeDomain is stellar.moneygram.com
    const result = await fetchAnchorHealth('stellar.moneygram.com');

    expect(result.anchorId).toBe('cowrie'); // mock returns cowrie here but it proves resolving hit the right fetch
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/anchors/moneygram/health',
      expect.any(Object)
    );
  });

  it('succeeds if requested asset is supported by the anchor', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(baseOkResponse),
    });

    // cowrie supports USDC (it has usdc-ngn corridor)
    const result = await fetchAnchorHealth('cowrie.exchange', 'USDC');
    expect(result).toEqual(baseOkResponse);
  });

  it('throws an error if requested asset is not supported by the anchor', async () => {
    await expect(fetchAnchorHealth('cowrie.exchange', 'EUR')).rejects.toThrow(
      'Asset "EUR" is not supported by anchor "cowrie.exchange"'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when anchor domain is unknown', async () => {
    await expect(fetchAnchorHealth('unknown-domain.com')).rejects.toThrow(
      'No anchor found with domain "unknown-domain.com"'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not Found'),
    });

    await expect(fetchAnchorHealth('cowrie.exchange')).rejects.toThrow(
      'Failed to fetch health for cowrie: 404 Not Found'
    );
  });

  it('throws on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(fetchAnchorHealth('cowrie.exchange')).rejects.toThrow('Network error');
  });

  it('uses NEXT_PUBLIC_APP_URL from env', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging.example.com';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(baseOkResponse),
    });

    await fetchAnchorHealth('cowrie.exchange');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://staging.example.com/api/v1/anchors/cowrie/health',
      expect.any(Object)
    );
  });

  it('tool name is correct', () => {
    expect(ANCHOR_HEALTH_TOOL_NAME).toBe('intel.anchor.health');
  });
});
