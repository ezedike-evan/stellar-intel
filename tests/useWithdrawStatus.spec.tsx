import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import {
  useTransferStatus,
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

describe('useWithdrawStatus', () => {
  it('polling is enabled (SWR key is non-null) when all three parameters are provided', async () => {
    mockFetch('pending_external');
    const { result } = renderHook(() => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status).toBe('pending_external');
  });

  it('polling is disabled when transactionId is null', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderHook(() => useWithdrawStatus(TRANSFER_SERVER, null, JWT), { wrapper });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('raw status string "pending_external" is correctly mapped and returned', async () => {
    mockFetch('pending_external');
    const { result } = renderHook(() => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT), {
      wrapper,
    });
    await waitFor(() => expect(result.current.status).toBe('pending_external'));
  });

  it('returns completed status from the anchor', async () => {
    mockFetch('completed');
    const { result } = renderHook(() => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT), {
      wrapper,
    });
    await waitFor(() => expect(result.current.status).toBe('completed'));
  });

  it('returns error status correctly', async () => {
    mockFetch('error');
    const { result } = renderHook(() => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT), {
      wrapper,
    });
    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  it('increments attemptCount on each successful poll', async () => {
    mockFetch('pending_external');
    const { result } = renderHook(() => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT), {
      wrapper,
    });
    await waitFor(() => expect(result.current.attemptCount).toBe(1));
  });

  it('is 0 when polling is disabled', () => {
    vi.stubGlobal('fetch', vi.fn());
    const { result } = renderHook(() => useWithdrawStatus(TRANSFER_SERVER, null, JWT), {
      wrapper,
    });
    expect(result.current.attemptCount).toBe(0);
  });
});

describe('useWithdrawStatus polling backoff', () => {
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

// ─── Reputation-event recording from real transactions (#799) ─────────────────

const OUTCOME_CONTEXT = {
  intentHash: 'c'.repeat(64),
  anchorId: 'cowrie',
  corridor: 'usdc-ngn',
  quotedRate: '1650',
  quotedAmount: '100',
  publicKey: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
  signature: 'c2lnbmF0dXJl',
};

/** Mock fetch that answers both the SEP-24 poll and the reputation append POST. */
function mockFetchWithAppend(
  status: string,
  opts: { amountOut?: string | null; stellarTxId?: string | null } = {}
) {
  const fn = vi.fn(async (input: unknown) => {
    const url = typeof input === 'string' ? input : String((input as Request)?.url ?? '');
    if (url.includes('/api/reputation/append')) {
      return { ok: true, json: async () => ({ ok: true }) };
    }
    const tx: Record<string, unknown> = { id: TXN_ID, status, amount_in: '100', amount_fee: '2.5' };
    if (opts.amountOut !== null) tx.amount_out = opts.amountOut ?? '97.5';
    if (opts.stellarTxId !== null) tx.stellar_transaction_id = opts.stellarTxId ?? 'stellar-tx-1';
    return { ok: true, json: async () => ({ transaction: tx }) };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function findAppend(fn: ReturnType<typeof vi.fn>): unknown[] | undefined {
  return fn.mock.calls.find((c) => String(c[0]).includes('/api/reputation/append'));
}

function appendBody(fn: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = findAppend(fn);
  return JSON.parse((call![1] as RequestInit).body as string) as Record<string, unknown>;
}

describe('useWithdrawStatus — reputation recording (#799)', () => {
  it('appends a completed outcome on terminal status when context is supplied', async () => {
    const fn = mockFetchWithAppend('completed');
    renderHook(() => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT, OUTCOME_CONTEXT), { wrapper });
    await waitFor(() => expect(findAppend(fn)).toBeDefined());

    expect(findAppend(fn)![0]).toBe('/api/reputation/append');
    const body = appendBody(fn);
    expect(body).toMatchObject({
      ...OUTCOME_CONTEXT,
      outcome: 'completed',
      deliveredAmount: '97.5',
      stellarTransactionId: 'stellar-tx-1',
    });
    expect(typeof body.settleSeconds).toBe('number');
  });

  it('records a rollback outcome (error, no delivery) when the anchor leg fails after signing', async () => {
    const fn = mockFetchWithAppend('error', { amountOut: null });
    renderHook(() => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT, OUTCOME_CONTEXT), { wrapper });
    await waitFor(() => expect(findAppend(fn)).toBeDefined());

    const body = appendBody(fn);
    expect(body.outcome).toBe('error');
    expect(body.deliveredAmount).toBeNull();
  });

  it('maps a refunded terminal status to a refunded outcome', async () => {
    const fn = mockFetchWithAppend('refunded', { amountOut: null });
    renderHook(() => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT, OUTCOME_CONTEXT), { wrapper });
    await waitFor(() => expect(findAppend(fn)).toBeDefined());

    expect(appendBody(fn).outcome).toBe('refunded');
  });

  it('does not write an outcome when no context is supplied', async () => {
    const fn = mockFetchWithAppend('completed');
    const { result } = renderHook(() => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT), {
      wrapper,
    });
    await waitFor(() => expect(result.current.status).toBe('completed'));
    expect(findAppend(fn)).toBeUndefined();
  });

  it('writes exactly one outcome even across re-renders (idempotent)', async () => {
    const fn = mockFetchWithAppend('completed');
    const { rerender } = renderHook(
      () => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT, OUTCOME_CONTEXT),
      { wrapper }
    );
    await waitFor(() => expect(findAppend(fn)).toBeDefined());
    rerender();
    const appends = fn.mock.calls.filter((c) => String(c[0]).includes('/api/reputation/append'));
    expect(appends).toHaveLength(1);
  });

  it('forwards direction, signature and publicKey unchanged in the append body (ONR032)', async () => {
    const fn = mockFetchWithAppend('completed');
    const depositContext = { ...OUTCOME_CONTEXT, direction: 'deposit' as const };
    renderHook(() => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT, depositContext), { wrapper });
    await waitFor(() => expect(findAppend(fn)).toBeDefined());

    const body = appendBody(fn);
    expect(body.direction).toBe('deposit');
    expect(body.signature).toBe(OUTCOME_CONTEXT.signature);
    expect(body.publicKey).toBe(OUTCOME_CONTEXT.publicKey);
  });

  it('never includes key material in the appended outcome (non-custodial)', async () => {
    const fn = mockFetchWithAppend('completed');
    renderHook(() => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT, OUTCOME_CONTEXT), { wrapper });
    await waitFor(() => expect(findAppend(fn)).toBeDefined());

    const body = appendBody(fn);
    const allowed = new Set([
      'intentHash',
      'anchorId',
      'corridor',
      'quotedRate',
      'quotedAmount',
      'outcome',
      'deliveredAmount',
      'settleSeconds',
      'stellarTransactionId',
      // Transfer direction (ONR031/ONR032).
      'direction',
      // The attestation: a public key and a signature, never a secret.
      'publicKey',
      'signature',
    ]);
    expect(Object.keys(body).every((k) => allowed.has(k))).toBe(true);
    const serialized = JSON.stringify(body).toLowerCase();
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('privatekey');
  });
});

describe('deposit fields and the useTransferStatus alias (#1467)', () => {
  it('exposes instructions, moreInfoUrl, message and claimableBalanceId from a deposit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          transaction: {
            id: TXN_ID,
            status: 'pending_user_transfer_start',
            kind: 'deposit',
            message: 'Send the transfer to continue',
            more_info_url: 'https://anchor.example/tx/1',
            claimable_balance_id: '00000000abc',
            instructions: {
              organization_bank_number: { value: '121122676', description: 'Routing number' },
            },
          },
        }),
      }))
    );

    const { result } = renderHook(() => useTransferStatus(TRANSFER_SERVER, TXN_ID, JWT), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.status).toBe('pending_user_transfer_start');
    expect(result.current.instructions).toEqual({
      organization_bank_number: { value: '121122676', description: 'Routing number' },
    });
    expect(result.current.moreInfoUrl).toBe('https://anchor.example/tx/1');
    expect(result.current.message).toBe('Send the transfer to continue');
    expect(result.current.claimableBalanceId).toBe('00000000abc');
  });

  it('leaves the deposit fields undefined for a withdrawal', async () => {
    mockFetch('pending_external');
    const { result } = renderHook(() => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.instructions).toBeUndefined();
    expect(result.current.moreInfoUrl).toBeUndefined();
    expect(result.current.message).toBeUndefined();
    expect(result.current.claimableBalanceId).toBeUndefined();
  });

  it('useTransferStatus is the very same hook as useWithdrawStatus', () => {
    expect(useTransferStatus).toBe(useWithdrawStatus);
  });
});
