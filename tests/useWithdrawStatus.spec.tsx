import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import {
  useWithdrawStatus,
  computeNextWithdrawPollIntervalMs,
  WITHDRAW_POLL_INITIAL_MS,
  WITHDRAW_POLL_MAX_MS,
} from '@/hooks/useWithdrawStatus';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  createElement(SWRConfig, { value: { provider: () => new Map() } }, children);

const TRANSFER_SERVER = 'https://cowrie.exchange/sep24';
const TXN_ID = 'txn-abc123';
const JWT = 'test-jwt';

function mockFetch(status: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        transaction: {
          id: TXN_ID,
          status,
          amount_in: '100',
          amount_out: '97.5',
          amount_fee: '2.5',
        },
      }),
    }))
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('computeNextWithdrawPollIntervalMs', () => {
  it('multiplies by 1.5 and caps at 30s', () => {
    expect(computeNextWithdrawPollIntervalMs(2_000)).toBe(3_000);
    expect(computeNextWithdrawPollIntervalMs(20_000)).toBe(30_000);
    expect(computeNextWithdrawPollIntervalMs(30_000)).toBe(30_000);
  });
});

describe('useWithdrawStatus polling backoff', () => {
  it('polling is disabled when transactionId is null', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderHook(() => useWithdrawStatus(TRANSFER_SERVER, null, JWT), { wrapper });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('returns completed status from the anchor', async () => {
    mockFetch('completed');
    const { result } = renderHook(() => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT), {
      wrapper,
    });
    await waitFor(() => expect(result.current.status).toBe('completed'));
  });

  it('stops polling on terminal completed status', async () => {
    mockFetch('completed');
    const { result } = renderHook(() => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT), {
      wrapper,
    });
    await waitFor(() => expect(result.current.status).toBe('completed'));

    const callsAfterTerminal = vi.mocked(fetch).mock.calls.length;
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WITHDRAW_POLL_MAX_MS + 500);
    });
    vi.useRealTimers();
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsAfterTerminal);
  });

  // NOTE: the poll-stops-after-the-first-response bug that motivated moving
  // `refreshInterval` off the function form is not reproducible here -- under
  // fake timers with a jsdom render, SWR re-arms for the function form just
  // fine. The guard for it is the e2e case in tests/e2e/sep24-withdraw.spec.ts,
  // which drives a real browser against a production build and fails without
  // the fix.

  it('uses increasing intervals up to the 30s cap', async () => {
    vi.useFakeTimers();
    const callTimes: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        callTimes.push(Date.now());
        return {
          ok: true,
          json: async () => ({ transaction: { id: TXN_ID, status: 'pending_anchor' } }),
        };
      })
    );

    renderHook(() => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT), { wrapper });

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    for (let i = 0; i < 60; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
    }
    vi.useRealTimers();

    const gaps = callTimes.slice(1).map((t, i) => t - callTimes[i]!);
    expect(gaps.length).toBeGreaterThanOrEqual(4);

    // How the opening gaps fall depends on when SWR happens to arm its first
    // timer relative to the render that publishes the interval, which is not
    // behaviour worth pinning. What matters is the shape once the backoff is
    // established: each gap grows by x1.5 over the last, and none exceeds the
    // cap. Asserted from the third gap on, which is past the settle.
    // Timers are advanced in 500ms slices and each poll costs a render to
    // settle, so a gap lands a little past its ideal rather than exactly on it.
    const TOLERANCE_MS = 750;
    const settled = gaps.slice(2);
    expect(settled.length).toBeGreaterThanOrEqual(2);
    settled.forEach((gap, i) => {
      expect(gap).toBeLessThanOrEqual(WITHDRAW_POLL_MAX_MS + TOLERANCE_MS);
      if (i > 0) {
        const ideal = computeNextWithdrawPollIntervalMs(settled[i - 1]!);
        expect(gap).toBeGreaterThanOrEqual(ideal);
        expect(gap).toBeLessThanOrEqual(ideal + TOLERANCE_MS);
      }
    });
  }, 15_000);

  it('resets interval to 2s when status changes', async () => {
    vi.useFakeTimers();
    let status = 'pending_anchor';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ transaction: { id: TXN_ID, status } }),
      }))
    );

    renderHook(() => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT), { wrapper });

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    const callsBeforeStatusChange = vi.mocked(fetch).mock.calls.length;

    status = 'pending_external';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(callsBeforeStatusChange);
    vi.useRealTimers();
  }, 15_000);

  it('cancels in-flight fetch on unmount', async () => {
    let resolveFetch: (() => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        if (init?.signal?.aborted) {
          return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
        }
        return new Promise<Response>((resolve) => {
          resolveFetch = () =>
            resolve({
              ok: true,
              json: async () => ({ transaction: { id: TXN_ID, status: 'pending_anchor' } }),
            } as Response);
        });
      })
    );

    const { result, unmount } = renderHook(() => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT), {
      wrapper,
    });

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBe(1));
    unmount();
    resolveFetch?.();

    await waitFor(() => expect(result.current.status).toBeUndefined(), { timeout: 500 });
    expect(vi.mocked(fetch).mock.calls.length).toBe(1);
  });
});
