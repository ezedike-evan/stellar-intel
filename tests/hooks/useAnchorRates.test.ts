import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { useAnchorRates } from '@/hooks/useAnchorRates';
import type { RateComparison } from '@/types';

// Fresh SWR cache per test — prevents cross-test cache pollution
const wrapper = ({ children }: { children: React.ReactNode }) =>
  createElement(SWRConfig, { value: { provider: () => new Map() } }, children);

const mockRates: RateComparison = {
  corridorId: 'usdc-ngn',
  bestRateId: 'cowrie',
  rates: [
    {
      anchorId: 'cowrie',
      anchorName: 'Cowrie Exchange',
      corridorId: 'usdc-ngn',
      fee: 2,
      feeType: 'flat',
      exchangeRate: 1580,
      totalReceived: 153660,
      updatedAt: new Date(),
    },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('useAnchorRates', () => {
  it('is loading on initial render', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    );
    const { result } = renderHook(() => useAnchorRates('usdc-ngn', '100'), { wrapper });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns rates with bestRateId once data loads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ rates: mockRates, fetchedAt: new Date().toISOString() }),
      }))
    );

    const { result } = renderHook(() => useAnchorRates('usdc-ngn', '100'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rates?.bestRateId).toBe('cowrie');
    expect(result.current.error).toBeUndefined();
  });

  it('exposes an error string when the fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ message: 'All anchors failed' }),
      }))
    );

    const { result } = renderHook(() => useAnchorRates('usdc-ngn', '100'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('All anchors failed');
    expect(result.current.rates).toBeUndefined();
  });
});
