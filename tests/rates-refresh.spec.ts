/**
 * Visibility-aware refresh scheduler tests.
 *
 * Asserts that the hook's two refresh mechanisms — the SWR interval and the
 * near-expiry watcher — both honour document visibility and the pause signal
 * that hiding the tab produces.
 */

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

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Fresh SWR cache per test — prevents cross-test cache pollution. */
const wrapper = ({ children }: { children: React.ReactNode }) =>
  createElement(SWRConfig, { value: { provider: () => new Map() } }, children);

/**
 * Wrapper that zeroes SWR's own background refresh so only the hook's
 * near-expiry watcher interval drives fetches in watcher-specific tests.
 */
const watcherWrapper = ({ children }: { children: React.ReactNode }) =>
  createElement(
    SWRConfig,
    { value: { provider: () => new Map(), refreshInterval: 0, revalidateOnFocus: false } },
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

function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
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

// ─── Suite setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
  setDocumentHidden(false);
});

afterEach(() => {
  vi.useRealTimers();
  setDocumentHidden(false);
});

// ─── SWR interval — visibility ───────────────────────────────────────────────

describe('rates refresh — SWR interval respects visibility', () => {
  it('does not tick the 30-second SWR interval while the tab is hidden', async () => {
    vi.useFakeTimers();
    const fetchMock = fetchOk(new Date());
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useAnchorRates('usdc-ngn', '100'), { wrapper });

    // Initial fetch on mount
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();

    // Hide the tab
    await dispatchVisibilityChange(true);

    // Advance well past three 30-second cycles — no re-fetch should occur
    await act(async () => {
      vi.advanceTimersByTime(90_000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('immediately re-fetches when the tab becomes visible again', async () => {
    vi.useFakeTimers();
    const fetchMock = fetchOk(new Date());
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useAnchorRates('usdc-ngn', '100'), { wrapper });

    await flushMicrotasks();
    fetchMock.mockClear();

    // Hide, advance time, then un-hide
    await dispatchVisibilityChange(true);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await dispatchVisibilityChange(false);
    await flushMicrotasks();

    // A single catch-up fetch should fire on visibility restore
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resumes the normal 30-second cadence after the tab becomes visible', async () => {
    vi.useFakeTimers();
    const fetchMock = fetchOk(new Date());
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useAnchorRates('usdc-ngn', '100'), { wrapper });

    await flushMicrotasks();
    fetchMock.mockClear();

    // Hide then restore
    await dispatchVisibilityChange(true);
    await dispatchVisibilityChange(false);
    await flushMicrotasks();
    fetchMock.mockClear();

    // Next 30-second cycle should fire now that tab is visible
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not fetch at all when the tab starts hidden', async () => {
    vi.useFakeTimers();
    // Set hidden BEFORE the hook mounts
    setDocumentHidden(true);

    const fetchMock = fetchOk(new Date());
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useAnchorRates('usdc-ngn', '100'), { wrapper });

    await flushMicrotasks();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── Near-expiry watcher — visibility ────────────────────────────────────────

describe('rates refresh — near-expiry watcher respects visibility', () => {
  it(
    'does not poll while the tab is hidden',
    async () => {
      // Quote is stale — 4 s validity left (below REFRESH_THRESHOLD_MS)
      const staleUpdatedAt = new Date(
        Date.now() - (QUOTE_VALIDITY_MS - REFRESH_THRESHOLD_MS + 1_000)
      );

      vi.stubGlobal('fetch', fetchOk(staleUpdatedAt));
      const { result } = renderHook(() => useAnchorRates('usdc-ngn', '100'), {
        wrapper: watcherWrapper,
      });
      await waitFor(() => expect(result.current.rates).toBeDefined());

      // Hide the tab, then install a spy for any watcher-triggered refresh
      await dispatchVisibilityChange(true);
      const hiddenFetch = fetchOk(new Date());
      vi.stubGlobal('fetch', hiddenFetch);

      // Wait 3 poll cycles — watcher must not fire while hidden
      await new Promise((resolve) =>
        setTimeout(resolve, EXPIRY_POLL_INTERVAL_MS * 3 + 100)
      );

      expect(hiddenFetch).not.toHaveBeenCalled();
    },
    EXPIRY_POLL_INTERVAL_MS * 7
  );

  it(
    'resumes polling and triggers a refresh when tab becomes visible again',
    async () => {
      const staleUpdatedAt = new Date(
        Date.now() - (QUOTE_VALIDITY_MS - REFRESH_THRESHOLD_MS + 1_000)
      );

      vi.stubGlobal('fetch', fetchOk(staleUpdatedAt));
      const { result } = renderHook(() => useAnchorRates('usdc-ngn', '100'), {
        wrapper: watcherWrapper,
      });
      await waitFor(() => expect(result.current.rates).toBeDefined());

      // Hide: confirm no poll fires
      await dispatchVisibilityChange(true);
      const hiddenFetch = fetchOk(new Date());
      vi.stubGlobal('fetch', hiddenFetch);
      await new Promise((resolve) => setTimeout(resolve, EXPIRY_POLL_INTERVAL_MS * 2 + 100));
      expect(hiddenFetch).not.toHaveBeenCalled();

      // Restore visibility — watcher should resume and trigger within 1 poll cycle
      const visibleFetch = fetchOk(new Date());
      vi.stubGlobal('fetch', visibleFetch);
      await dispatchVisibilityChange(false);

      await waitFor(() => expect(visibleFetch).toHaveBeenCalledTimes(1), {
        timeout: EXPIRY_POLL_INTERVAL_MS * 3 + 500,
      });
    },
    EXPIRY_POLL_INTERVAL_MS * 10
  );

  it(
    'watcher interval is torn down when tab is hidden (clearInterval called)',
    async () => {
      vi.stubGlobal('fetch', fetchOk(new Date()));
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

      const { result } = renderHook(() => useAnchorRates('usdc-ngn', '100'), {
        wrapper: watcherWrapper,
      });
      await waitFor(() => expect(result.current.rates).toBeDefined());

      // Hiding the tab changes isDocumentVisible, which causes the effect to
      // re-run — cleanup (clearInterval) fires before the effect exits early.
      await dispatchVisibilityChange(true);

      expect(clearIntervalSpy).toHaveBeenCalled();
    },
    EXPIRY_POLL_INTERVAL_MS * 5
  );
});
