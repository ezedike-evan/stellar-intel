import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import {
  useAnchorRates,
  QUOTE_VALIDITY_MS,
  REFRESH_THRESHOLD_MS,
  EXPIRY_POLL_INTERVAL_MS,
} from '@/hooks/useAnchorRates';
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

// ─── Auto-refresh watcher (#087 / PR #252) ──────────────────────────────────────

// Dedicated wrapper that disables SWR's own background refresh so only the
// hook's near-expiry watcher interval drives fetches in these tests.
const watcherWrapper = ({ children }: { children: React.ReactNode }) =>
  createElement(
    SWRConfig,
    {
      value: { provider: () => new Map(), refreshInterval: 0, revalidateOnFocus: false },
    },
    children
  );

function makeMockRates(updatedAt: Date): RateComparison {
  return {
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
        totalReceived: 153_660,
        source: 'sep24-fee' as const,
        updatedAt,
      },
    ],
  };
}

function fetchOk(updatedAt: Date) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      rates: makeMockRates(updatedAt),
      fetchedAt: new Date().toISOString(),
    }),
  }));
}

describe('useAnchorRates — exported constants', () => {
  it('QUOTE_VALIDITY_MS is 30 000', () => {
    expect(QUOTE_VALIDITY_MS).toBe(30_000);
  });

  it('REFRESH_THRESHOLD_MS is 5 000', () => {
    expect(REFRESH_THRESHOLD_MS).toBe(5_000);
  });

  it('EXPIRY_POLL_INTERVAL_MS is 1 000', () => {
    expect(EXPIRY_POLL_INTERVAL_MS).toBe(1_000);
  });
});

describe('useAnchorRates — auto-refresh watcher', () => {
  // These tests use real timers. The watcher polls every EXPIRY_POLL_INTERVAL_MS
  // (1 s) so we wait up to 3 s for the trigger/no-trigger assertion.

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it(
    'triggers a refresh when any rate row has <5s validity remaining',
    async () => {
      // Quote is 26 seconds old — 4 s validity left, under the 5 s threshold
      const staleUpdatedAt = new Date(
        Date.now() - (QUOTE_VALIDITY_MS - REFRESH_THRESHOLD_MS + 1_000)
      );

      vi.stubGlobal('fetch', fetchOk(staleUpdatedAt));
      const { result } = renderHook(() => useAnchorRates('usdc-ngn', '100'), {
        wrapper: watcherWrapper,
      });
      await waitFor(() => expect(result.current.rates).toBeDefined());

      // Swap in the auto-refresh spy
      const refreshFetch = fetchOk(new Date());
      vi.stubGlobal('fetch', refreshFetch);

      // Wait for watcher to poll (up to 3 × poll interval)
      await waitFor(() => expect(refreshFetch).toHaveBeenCalledTimes(1), {
        timeout: EXPIRY_POLL_INTERVAL_MS * 3 + 500,
      });
    },
    EXPIRY_POLL_INTERVAL_MS * 5
  );

  it(
    'does NOT trigger auto-refresh when quotes are still fresh',
    async () => {
      // Quote is brand new — far from expiry
      vi.stubGlobal('fetch', fetchOk(new Date()));
      const { result } = renderHook(() => useAnchorRates('usdc-ngn', '100'), {
        wrapper: watcherWrapper,
      });
      await waitFor(() => expect(result.current.rates).toBeDefined());

      const watcherFetch = fetchOk(new Date());
      vi.stubGlobal('fetch', watcherFetch);

      // Wait 3 poll cycles — no refresh should fire
      await new Promise((resolve) => setTimeout(resolve, EXPIRY_POLL_INTERVAL_MS * 3 + 100));

      expect(watcherFetch).not.toHaveBeenCalled();
    },
    EXPIRY_POLL_INTERVAL_MS * 5
  );

  it(
    'does NOT spam — concurrent refreshes are skipped',
    async () => {
      const staleUpdatedAt = new Date(
        Date.now() - (QUOTE_VALIDITY_MS - REFRESH_THRESHOLD_MS + 2_000)
      );

      vi.stubGlobal('fetch', fetchOk(staleUpdatedAt));
      const { result } = renderHook(() => useAnchorRates('usdc-ngn', '100'), {
        wrapper: watcherWrapper,
      });
      await waitFor(() => expect(result.current.rates).toBeDefined());

      // Slow fetch that hangs for 5 poll cycles — simulates in-flight refresh
      const slowFetch = vi.fn(
        () =>
          new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: async () => ({
                    rates: makeMockRates(new Date()),
                    fetchedAt: new Date().toISOString(),
                  }),
                }),
              EXPIRY_POLL_INTERVAL_MS * 5
            )
          )
      );
      vi.stubGlobal('fetch', slowFetch);

      // Wait for the first poll to trigger exactly one in-flight refresh …
      await waitFor(() => expect(slowFetch).toHaveBeenCalledTimes(1), {
        timeout: EXPIRY_POLL_INTERVAL_MS * 3 + 500,
      });

      // … then wait 2 more poll cycles to confirm no additional calls
      await new Promise((resolve) => setTimeout(resolve, EXPIRY_POLL_INTERVAL_MS * 2 + 100));

      expect(slowFetch).toHaveBeenCalledTimes(1);
    },
    EXPIRY_POLL_INTERVAL_MS * 10
  );

  it('cleans up the interval on unmount', async () => {
    vi.stubGlobal('fetch', fetchOk(new Date()));

    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    const { unmount, result } = renderHook(() => useAnchorRates('usdc-ngn', '100'), {
      wrapper: watcherWrapper,
    });
    await waitFor(() => expect(result.current.rates).toBeDefined());

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});
