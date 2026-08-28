import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { useWithdrawStatus } from '@/hooks/useWithdrawStatus';

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

  it('polling is disabled (SWR key is null) when transactionId is null', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderHook(() => useWithdrawStatus(TRANSFER_SERVER, null, JWT), { wrapper });
    // fetch should never be called
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('raw status string "pending_external" is correctly mapped and returned', async () => {
    mockFetch('pending_external');
    const { result } = renderHook(() => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT), {
      wrapper,
    });
    await waitFor(() => expect(result.current.status).toBe('pending_external'));
  });

  it('returns completed status correctly', async () => {
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

// ─── Reputation-event recording from real transactions (#799) ─────────────────

const OUTCOME_CONTEXT = {
  intentHash: TXN_ID,
  anchorId: 'cowrie',
  corridor: 'usdc-ngn',
  quotedRate: '1650',
  quotedAmount: '100',
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
    ]);
    expect(Object.keys(body).every((k) => allowed.has(k))).toBe(true);
    const serialized = JSON.stringify(body).toLowerCase();
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('privatekey');
  });
});
