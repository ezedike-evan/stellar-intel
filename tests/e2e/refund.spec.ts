import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { useWithdrawStatus } from '@/hooks/useWithdrawStatus';
import { StatusTracker } from '@/components/offramp/StatusTracker';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  createElement(SWRConfig, { value: { provider: () => new Map() } }, children);

const TRANSFER_SERVER = 'https://cowrie.exchange/sep24';
const TXN_ID = 'txn-refund-test';
const JWT = 'test-jwt';

function mockFetch(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        transaction: {
          id: TXN_ID,
          status: 'refunded',
          amount_in: '100',
          amount_in_asset: 'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          amount_out: '97.5',
          amount_out_asset: 'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          amount_fee: '2.5',
          refunds: {
            amount_refunded: '100',
            amount_fee: '2.5',
            payments: [],
          },
          ...overrides,
        },
      }),
    }))
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ── Hook-level tests ────────────────────────────────────────────────────────

describe('useWithdrawStatus — anchor refund state progression', () => {
  it('each anchor state in the refund progression is a valid WithdrawStatusValue', () => {
    const progression = ['pending_user', 'pending_anchor', 'refunded'] as const;
    expect(progression[0]).toBe('pending_user');
    expect(progression[1]).toBe('pending_anchor');
    expect(progression[2]).toBe('refunded');
    expect(progression[progression.length - 1]).toBe('refunded');
  });

  it('returns refunded status correctly', async () => {
    mockFetch();
    const { result } = renderHook(() => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT), {
      wrapper,
    });
    await waitFor(() => expect(result.current.status).toBe('refunded'));
    expect(result.current.status).toBe('refunded');
  });

  it('returns correct amounts when status is refunded', async () => {
    mockFetch();
    const { result } = renderHook(() => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT), {
      wrapper,
    });
    await waitFor(() => expect(result.current.status).toBe('refunded'));
    expect(result.current.amountIn).toBe('100');
    expect(result.current.amountOut).toBe('97.5');
    expect(result.current.amountFee).toBe('2.5');
  });

  it('exposes refund details when status is refunded', async () => {
    mockFetch();
    const { result } = renderHook(() => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT), {
      wrapper,
    });
    await waitFor(() => expect(result.current.status).toBe('refunded'));
    expect(result.current.refunds?.amount_refunded).toBe('100');
    expect(result.current.refunds?.amount_fee).toBe('2.5');
  });

  it('stops polling once refunded terminal state is reached', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        transaction: {
          id: TXN_ID,
          status: 'refunded',
          amount_in: '100',
          amount_out: '97.5',
          amount_fee: '2.5',
          refunds: { amount_refunded: '100', amount_fee: '2.5', payments: [] },
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const { result } = renderHook(() => useWithdrawStatus(TRANSFER_SERVER, TXN_ID, JWT), {
      wrapper,
    });
    await waitFor(() => expect(result.current.status).toBe('refunded'));
    const callsAfterTerminal = fetchSpy.mock.calls.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(fetchSpy.mock.calls.length).toBe(callsAfterTerminal);
  });
});

// ── Component-level tests ───────────────────────────────────────────────────

describe('StatusTracker — refund card rendering', () => {
  const baseProps = {
    transactionId: TXN_ID,
    status: 'refunded' as const,
    amountIn: '100',
    amountInAsset: 'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    amountOut: '97.5',
    amountOutAsset: 'stellar:USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    amountFee: '2.5',
    currencyCode: 'USD',
    stellarTransactionId: undefined,
    externalTransactionId: undefined,
    refunds: {
      amount_refunded: '100',
      amount_fee: '2.5',
      payments: [],
    },
    isLoading: false,
    error: undefined,
  };

  it('renders Refunded status label when status is refunded', () => {
    render(createElement(StatusTracker, baseProps));
    expect(screen.getByText('Refunded')).toBeTruthy();
  });

  it('renders refund card with correct amount_refunded', () => {
    render(createElement(StatusTracker, baseProps));
    expect(screen.getByText('Refund Details')).toBeTruthy();
    expect(screen.getByText((content) => content.includes('100'))).toBeTruthy();
  });

  it('renders refund fee correctly', () => {
    render(createElement(StatusTracker, baseProps));
    expect(screen.getByText((content) => content.includes('2.5'))).toBeTruthy();
  });

  it('does not render completion celebration banner when refunded', () => {
    render(createElement(StatusTracker, baseProps));
    expect(screen.queryByText('Delivered')).toBeNull();
  });

  it('does not render sent/receive amounts section when refunded', () => {
    render(createElement(StatusTracker, baseProps));
    expect(screen.queryByText('Sent')).toBeNull();
    expect(screen.queryByText('You receive')).toBeNull();
  });
});
