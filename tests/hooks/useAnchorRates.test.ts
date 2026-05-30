import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
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
      source: 'sep24-fee' as const,
      updatedAt: new Date(),
    },
  ],
};

function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: hidden,
  });
}

async function dispatchVisibilityChange(hidden: boolean): Promise<void> {
  setDocumentHidden(hidden);
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  setDocumentHidden(false);
});

afterEach(() => {
  vi.useRealTimers();
  setDocumentHidden(false);
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

  it('auto-refreshes every 30 seconds while the tab is visible', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ rates: mockRates, fetchedAt: new Date().toISOString() }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useAnchorRates('usdc-ngn', '100'), { wrapper });

    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('pauses auto-refresh while hidden and resumes on visibilitychange', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ rates: mockRates, fetchedAt: new Date().toISOString() }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useAnchorRates('usdc-ngn', '100'), { wrapper });

    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();

    await dispatchVisibilityChange(true);

    await act(async () => {
      vi.advanceTimersByTime(90_000);
    });

    expect(fetchMock).not.toHaveBeenCalled();

    await dispatchVisibilityChange(false);
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
